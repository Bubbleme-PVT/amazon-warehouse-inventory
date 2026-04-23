const XLSX = require('xlsx');
const { randomUUID } = require('crypto');
const {
  buildNormalizedRows,
  buildSummary,
  applyFilters,
  generateKpis,
  generateAlerts,
  buildSalesTrendSeries,
  buildStockByWarehouseSeries,
  buildProductMixSeries,
  buildFilterOptions,
  createExportRows,
  rowsToCsvBuffer,
  validateMappings,
  prepareUploadSheets,
  normalizeHeaderKeys,
  mergePreparedSheets
} = require('../utils/calculations');

const uploadStore = new Map();
const exportStore = new Map();

function getRowsFromRequest(body) {
  if (Array.isArray(body.rawRows) && body.rawRows.length) {
    return normalizeHeaderKeys(body.rawRows);
  }

  if (!body.uploadId) {
    throw new Error('uploadId or rawRows is required');
  }

  const upload = uploadStore.get(body.uploadId);
  if (!upload) {
    throw new Error('Uploaded file not found or expired');
  }

  const sheetName = body.sheetName || upload.defaultSheetName;
  const sheet = upload.sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  return sheet.rows;
}

function uploadFiles(req, res) {
  const files = Array.isArray(req.files) && req.files.length
    ? req.files
    : req.file
      ? [req.file]
      : [];

  if (!files.length) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const preparedEntries = [];
  const fileNames = [];

  for (const file of files) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const preparedSheets = prepareUploadSheets(workbook);

    if (!preparedSheets.length) continue;

    fileNames.push(file.originalname);

    preparedSheets.forEach((sheet, index) => {
      const displayName = files.length > 1 || preparedSheets.length > 1
        ? `${file.originalname} • ${sheet.name || `Sheet ${index + 1}`}`
        : (sheet.name || file.originalname);

      preparedEntries.push({
        ...sheet,
        name: displayName,
        sourceFile: file.originalname,
        sourceSheet: sheet.name || `Sheet ${index + 1}`
      });
    });
  }

  if (!preparedEntries.length) {
    return res.status(400).json({ error: 'Workbook does not contain any readable sheets' });
  }

  let finalSheets = [...preparedEntries];
  let defaultSheetName = preparedEntries[0].name;
  let merged = false;

  if (files.length > 1) {
    const mergedSheet = mergePreparedSheets(preparedEntries, 'Merged Data (All uploaded files)');
    finalSheets = [mergedSheet, ...preparedEntries];
    defaultSheetName = mergedSheet.name;
    merged = true;
  }

  const uploadId = randomUUID();
  const sheets = Object.fromEntries(
    finalSheets.map((sheet) => [
      sheet.name,
      {
        headers: sheet.headers,
        rowCount: sheet.rowCount,
        preview: sheet.preview,
        rows: sheet.rows,
        sourceFile: sheet.sourceFile || null,
        sourceSheet: sheet.sourceSheet || sheet.name
      }
    ])
  );

  uploadStore.set(uploadId, {
    fileNames,
    uploadedAt: new Date().toISOString(),
    defaultSheetName,
    sheets
  });

  return res.json({
    success: true,
    uploadId,
    fileNames,
    merged,
    defaultSheetName,
    sheets: finalSheets.map((sheet) => ({
      name: sheet.name,
      headers: sheet.headers,
      rowCount: sheet.rowCount,
      preview: sheet.preview,
      sourceFile: sheet.sourceFile || null,
      sourceSheet: sheet.sourceSheet || sheet.name
    }))
  });
}

function buildDashboard(req, res) {
  const { mappings = {}, settings = {}, filters = {}, sheetName = null } = req.body || {};
  const mappingValidation = validateMappings(mappings);

  if (!mappingValidation.valid) {
    return res.status(400).json({
      error: 'Missing required mappings',
      missing: mappingValidation.missing
    });
  }

  let rawRows;
  try {
    rawRows = getRowsFromRequest(req.body || {});
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const normalizedRows = buildNormalizedRows(rawRows, mappings);
  if (!normalizedRows.length) {
    return res.status(400).json({ error: 'No valid rows found after applying the selected mappings' });
  }

  const summary = buildSummary(normalizedRows, settings);
  const filteredSummary = applyFilters(summary, filters);
  const kpis = generateKpis(filteredSummary, settings);
  const alerts = generateAlerts(filteredSummary, settings);
  const chartData = {
    salesTrend: buildSalesTrendSeries(filteredSummary),
    stockByWarehouse: buildStockByWarehouseSeries(filteredSummary),
    productMix: buildProductMixSeries(filteredSummary)
  };
  const filterOptions = buildFilterOptions(summary);

  const exportId = randomUUID();
  exportStore.set(exportId, {
    createdAt: new Date().toISOString(),
    rows: createExportRows(filteredSummary)
  });

  return res.json({
    success: true,
    meta: {
      rowCount: rawRows.length,
      normalizedRowCount: normalizedRows.length,
      sheetName,
      summaryCount: summary.length,
      filteredCount: filteredSummary.length
    },
    filterOptions,
    kpis,
    alerts,
    charts: chartData,
    summary: filteredSummary,
    exportId
  });
}

function exportSummary(req, res) {
  const { exportId } = req.query;
  if (!exportId) {
    return res.status(400).json({ error: 'exportId is required' });
  }

  const exportData = exportStore.get(exportId);
  if (!exportData) {
    return res.status(404).json({ error: 'Export data not found or expired' });
  }

  const buffer = rowsToCsvBuffer(exportData.rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="warehouse_summary_export.csv"');
  return res.send(buffer);
}

module.exports = {
  uploadFiles,
  buildDashboard,
  exportSummary
};
