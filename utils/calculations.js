const XLSX = require('xlsx');

const DEFAULT_WARNING_BUFFER_DAYS = 10;

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const parsed = new Date(excelEpoch.getTime() + value * 86400000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return null;
}

function normalizeHeaderKeys(rows) {
  return rows.map((row) => {
    const out = {};
    Object.keys(row || {}).forEach((key) => {
      out[String(key).trim()] = row[key];
    });
    return out;
  });
}


function buildHeadersFromRows(rows) {
  const headerSet = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => headerSet.add(String(key).trim()));
  });
  return [...headerSet];
}

function alignRowsToHeaders(rows, headers) {
  return rows.map((row) => {
    const output = {};
    headers.forEach((header) => {
      output[header] = row && Object.prototype.hasOwnProperty.call(row, header) ? row[header] : '';
    });
    return output;
  });
}

function mergePreparedSheets(preparedSheets, mergedName = 'Merged Data') {
  const mergedRows = preparedSheets.flatMap((sheet) => sheet.rows || []);
  const headers = buildHeadersFromRows(mergedRows);
  const alignedRows = alignRowsToHeaders(mergedRows, headers);

  return {
    name: mergedName,
    headers,
    rowCount: alignedRows.length,
    preview: alignedRows.slice(0, 4),
    rows: alignedRows
  };
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function median(arr) {
  if (!arr.length) return 0;
  const copy = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

function calculatePeriodDays(rows) {
  const sorted = rows
    .filter((row) => row.date)
    .sort((a, b) => a.date - b.date);

  if (sorted.length < 2) return 30;

  const diffs = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const diffDays = Math.max(
      1,
      Math.round((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86400000)
    );
    diffs.push(diffDays);
  }

  return Math.max(1, Math.round(average(diffs)));
}

function getStatus(daysCover, threshold, warningBuffer = DEFAULT_WARNING_BUFFER_DAYS) {
  if (!Number.isFinite(daysCover) || daysCover <= threshold) return 'critical';
  if (daysCover <= threshold + warningBuffer) return 'warning';
  return 'healthy';
}

function getMappedValue(row, mappings, key) {
  const mappedHeader = mappings[key];
  return mappedHeader ? row[mappedHeader] : '';
}

function buildNormalizedRows(rawRows, mappings) {
  return rawRows
    .map((row) => ({
      source: row,
      date: parseDateValue(getMappedValue(row, mappings, 'date')),
      warehouse: String(getMappedValue(row, mappings, 'warehouse') || 'Unknown').trim() || 'Unknown',
      product: String(getMappedValue(row, mappings, 'product') || 'Unknown').trim() || 'Unknown',
      sentQty: parseNumber(getMappedValue(row, mappings, 'sentQty')),
      soldQty: parseNumber(getMappedValue(row, mappings, 'soldQty')),
      closingStock: parseNumber(getMappedValue(row, mappings, 'closingStock')),
      inTransit: parseNumber(getMappedValue(row, mappings, 'inTransit')),
      leadTimeDays: Math.max(0, parseNumber(getMappedValue(row, mappings, 'leadTimeDays')))
    }))
    .filter((row) => row.date || row.warehouse || row.product);
}

function buildSummary(normalizedRows, settings = {}) {
  if (!normalizedRows.length) {
    return [];
  }

  const lookbackPeriods = Math.max(1, parseNumber(settings.lookbackPeriods) || 3);
  const bufferDays = Math.max(0, parseNumber(settings.bufferDays) || 21);
  const fallbackLeadDays = Math.max(0, parseNumber(settings.fallbackLeadDays) || 7);

  const groups = new Map();
  normalizedRows.forEach((row) => {
    const key = `${row.warehouse}|||${row.product}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const summary = [];

  groups.forEach((groupRows, key) => {
    const sorted = [...groupRows].sort((a, b) => {
      const da = a.date ? a.date.getTime() : 0;
      const db = b.date ? b.date.getTime() : 0;
      return da - db;
    });

    const latest = sorted[sorted.length - 1];
    const trailing = sorted.slice(-lookbackPeriods);
    const avgSalesPerPeriod = average(trailing.map((row) => row.soldQty));
    const periodDays = calculatePeriodDays(trailing);
    const avgDailySales = periodDays > 0 ? avgSalesPerPeriod / periodDays : 0;
    const availableStock = latest.closingStock;
    const inTransit = latest.inTransit;
    const totalEffectiveStock = availableStock + inTransit;
    const leadTimeDays = latest.leadTimeDays || fallbackLeadDays;
    const threshold = leadTimeDays + bufferDays;
    const daysCover = avgDailySales > 0 ? totalEffectiveStock / avgDailySales : Number.POSITIVE_INFINITY;
    const status = getStatus(daysCover, threshold);
    const recommendedDispatch = Math.max(0, Math.ceil((avgDailySales * threshold) - totalEffectiveStock));

    summary.push({
      key,
      warehouse: latest.warehouse,
      product: latest.product,
      latestDate: latest.date ? latest.date.toISOString() : null,
      availableStock,
      inTransit,
      avgSalesPerPeriod,
      avgDailySales,
      periodDays,
      daysCover,
      leadTimeDays,
      threshold,
      status,
      recommendedDispatch,
      allRows: sorted.map((row) => ({
        date: row.date ? row.date.toISOString() : null,
        soldQty: row.soldQty,
        warehouse: row.warehouse,
        product: row.product
      }))
    });
  });

  summary.sort((a, b) => {
    const order = { critical: 0, warning: 1, healthy: 2 };
    const byStatus = order[a.status] - order[b.status];
    if (byStatus !== 0) return byStatus;
    return a.daysCover - b.daysCover;
  });

  return summary;
}

function applyFilters(summary, filters = {}) {
  const warehouse = filters.warehouse || 'all';
  const product = filters.product || 'all';
  const urgency = filters.urgency || 'all';

  return summary.filter((row) => {
    const warehouseOk = warehouse === 'all' || row.warehouse === warehouse;
    const productOk = product === 'all' || row.product === product;
    const urgencyOk = urgency === 'all' || row.status === urgency;
    return warehouseOk && productOk && urgencyOk;
  });
}

function generateKpis(filteredSummary, settings = {}) {
  const totalStock = filteredSummary.reduce((sum, row) => sum + row.availableStock, 0);
  const totalInTransit = filteredSummary.reduce((sum, row) => sum + row.inTransit, 0);
  const totalAvgDailySales = filteredSummary.reduce((sum, row) => sum + row.avgDailySales, 0);
  const atRisk = filteredSummary.filter((row) => row.status === 'critical' || row.status === 'warning').length;
  const medianCover = median(
    filteredSummary.filter((row) => Number.isFinite(row.daysCover)).map((row) => row.daysCover)
  );
  const totalRecommended = filteredSummary.reduce((sum, row) => sum + row.recommendedDispatch, 0);

  return {
    totalStock,
    totalInTransit,
    totalAvgDailySales,
    atRisk,
    medianCover,
    totalRecommended,
    lookbackPeriods: Math.max(1, parseNumber(settings.lookbackPeriods) || 3)
  };
}

function generateAlerts(filteredSummary, settings = {}) {
  const bufferDays = Math.max(0, parseNumber(settings.bufferDays) || 21);

  return filteredSummary
    .filter((row) => row.status !== 'healthy')
    .slice(0, 8)
    .map((row) => ({
      warehouse: row.warehouse,
      product: row.product,
      status: row.status,
      daysCover: row.daysCover,
      threshold: row.threshold,
      leadTimeDays: row.leadTimeDays,
      bufferDays,
      recommendedDispatch: row.recommendedDispatch,
      tone: row.status === 'critical' ? 'Dispatch now' : 'Plan dispatch soon'
    }));
}

function buildSalesTrendSeries(filteredSummary) {
  const dataMap = new Map();

  filteredSummary.forEach((summaryRow) => {
    summaryRow.allRows.forEach((row) => {
      const label = row.date ? row.date.slice(0, 10) : 'Unknown';
      if (!dataMap.has(label)) dataMap.set(label, 0);
      dataMap.set(label, dataMap.get(label) + row.soldQty);
    });
  });

  const labels = [...dataMap.keys()].sort();
  return {
    labels,
    values: labels.map((label) => dataMap.get(label))
  };
}

function buildStockByWarehouseSeries(filteredSummary) {
  const dataMap = new Map();

  filteredSummary.forEach((row) => {
    if (!dataMap.has(row.warehouse)) dataMap.set(row.warehouse, 0);
    dataMap.set(row.warehouse, dataMap.get(row.warehouse) + row.availableStock);
  });

  const labels = [...dataMap.keys()];
  return {
    labels,
    values: labels.map((label) => dataMap.get(label))
  };
}

function buildProductMixSeries(filteredSummary) {
  const dataMap = new Map();

  filteredSummary.forEach((row) => {
    if (!dataMap.has(row.product)) dataMap.set(row.product, 0);
    dataMap.set(row.product, dataMap.get(row.product) + row.availableStock);
  });

  const labels = [...dataMap.keys()];
  return {
    labels,
    values: labels.map((label) => dataMap.get(label))
  };
}

function buildFilterOptions(summary) {
  return {
    warehouses: [...new Set(summary.map((row) => row.warehouse))].sort(),
    products: [...new Set(summary.map((row) => row.product))].sort()
  };
}

function createExportRows(summary) {
  return summary.map((row) => ({
    Warehouse: row.warehouse,
    Product: row.product,
    Latest_Period: row.latestDate ? row.latestDate.slice(0, 10) : '',
    Available_Stock: row.availableStock,
    In_Transit: row.inTransit,
    Avg_Sales_Per_Period: Number(row.avgSalesPerPeriod.toFixed(2)),
    Avg_Daily_Sales: Number(row.avgDailySales.toFixed(4)),
    Days_Of_Cover: Number.isFinite(row.daysCover) ? Number(row.daysCover.toFixed(2)) : '',
    Lead_Time_Days: row.leadTimeDays,
    Status: row.status,
    Recommended_Dispatch: row.recommendedDispatch
  }));
}

function rowsToCsvBuffer(rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  return Buffer.from(csv, 'utf8');
}

function validateMappings(mappings = {}) {
  const requiredKeys = ['date', 'warehouse', 'product', 'soldQty', 'closingStock'];
  const missing = requiredKeys.filter((key) => !mappings[key]);
  return {
    valid: missing.length === 0,
    missing
  };
}

function prepareUploadSheets(workbook) {
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const normalized = normalizeHeaderKeys(json);
    const headers = normalized.length ? Object.keys(normalized[0]) : [];

    return {
      name: sheetName,
      headers,
      rowCount: normalized.length,
      preview: normalized.slice(0, 4),
      rows: normalized
    };
  });
}

module.exports = {
  parseNumber,
  parseDateValue,
  normalizeHeaderKeys,
  average,
  median,
  calculatePeriodDays,
  getStatus,
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
  buildHeadersFromRows,
  alignRowsToHeaders,
  mergePreparedSheets
};
