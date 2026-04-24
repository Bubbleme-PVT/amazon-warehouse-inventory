import { buildMergedDashboardRows, TARGET_HEADERS } from './mergeEngine.js';
import {
  buildNormalizedRows, buildSummary, applyFilters, generateKpis, generateAlerts,
  buildSalesTrendSeries, buildStockByWarehouseSeries, buildProductMixSeries,
  buildFilterOptions, createExportRows
} from './calculations.js';

const mappingConfig = [
  { key: 'date', label: 'Date / Month', required: true },
  { key: 'warehouse', label: 'Warehouse', required: true },
  { key: 'product', label: 'Product / SKU', required: true },
  { key: 'sentQty', label: 'Sent Qty', required: false },
  { key: 'soldQty', label: 'Sold Qty', required: true },
  { key: 'closingStock', label: 'Closing Stock / Available Stock', required: true },
  { key: 'inTransit', label: 'In Transit Qty', required: false },
  { key: 'leadTimeDays', label: 'Lead Time Days', required: false }
];

const autoMapPatterns = {
  date: [/^date$/i, /^month$/i, /period/i, /date|month/i],
  warehouse: [/warehouse/i, /fc/i, /fulfil/i, /location/i],
  product: [/sku/i, /product/i, /item/i, /asin/i, /name/i],
  sentQty: [/sent/i, /dispatch/i, /shipped/i, /inward/i],
  soldQty: [/sold/i, /sale/i, /units sold/i, /qty sold/i],
  closingStock: [/closing/i, /stock/i, /available/i, /balance/i, /remaining/i, /inventory/i],
  inTransit: [/transit/i, /in transit/i, /receiving/i],
  leadTimeDays: [/lead/i, /days/i, /lead time/i]
};

const sampleRows = [
  { Month: '2026-01-01', Warehouse: 'Delhi FC', Product: 'Spoil Yourself', Sent_Qty: 300, Sold_Qty: 180, Closing_Stock: 120, In_Transit: 0, Lead_Time_Days: 7 },
  { Month: '2026-02-01', Warehouse: 'Delhi FC', Product: 'Spoil Yourself', Sent_Qty: 220, Sold_Qty: 190, Closing_Stock: 150, In_Transit: 0, Lead_Time_Days: 7 },
  { Month: '2026-03-01', Warehouse: 'Delhi FC', Product: 'Spoil Yourself', Sent_Qty: 260, Sold_Qty: 210, Closing_Stock: 200, In_Transit: 30, Lead_Time_Days: 7 },
  { Month: '2026-04-01', Warehouse: 'Delhi FC', Product: 'Spoil Yourself', Sent_Qty: 120, Sold_Qty: 110, Closing_Stock: 210, In_Transit: 20, Lead_Time_Days: 7 },
  { Month: '2026-01-01', Warehouse: 'Mumbai FC', Product: 'Spoil Yourself', Sent_Qty: 280, Sold_Qty: 160, Closing_Stock: 120, In_Transit: 0, Lead_Time_Days: 8 },
  { Month: '2026-02-01', Warehouse: 'Mumbai FC', Product: 'Spoil Yourself', Sent_Qty: 180, Sold_Qty: 170, Closing_Stock: 130, In_Transit: 0, Lead_Time_Days: 8 },
  { Month: '2026-03-01', Warehouse: 'Mumbai FC', Product: 'Spoil Yourself', Sent_Qty: 180, Sold_Qty: 185, Closing_Stock: 125, In_Transit: 0, Lead_Time_Days: 8 },
  { Month: '2026-04-01', Warehouse: 'Mumbai FC', Product: 'Spoil Yourself', Sent_Qty: 100, Sold_Qty: 115, Closing_Stock: 110, In_Transit: 0, Lead_Time_Days: 8 },
  { Month: '2026-01-01', Warehouse: 'Delhi FC', Product: 'Reset Kit', Sent_Qty: 240, Sold_Qty: 110, Closing_Stock: 130, In_Transit: 0, Lead_Time_Days: 7 },
  { Month: '2026-02-01', Warehouse: 'Delhi FC', Product: 'Reset Kit', Sent_Qty: 160, Sold_Qty: 130, Closing_Stock: 160, In_Transit: 0, Lead_Time_Days: 7 },
  { Month: '2026-03-01', Warehouse: 'Delhi FC', Product: 'Reset Kit', Sent_Qty: 160, Sold_Qty: 145, Closing_Stock: 175, In_Transit: 0, Lead_Time_Days: 7 },
  { Month: '2026-04-01', Warehouse: 'Delhi FC', Product: 'Reset Kit', Sent_Qty: 60, Sold_Qty: 95, Closing_Stock: 140, In_Transit: 0, Lead_Time_Days: 7 },
  { Month: '2026-01-01', Warehouse: 'Bengaluru FC', Product: 'Yellow Ritual', Sent_Qty: 100, Sold_Qty: 45, Closing_Stock: 55, In_Transit: 0, Lead_Time_Days: 10 },
  { Month: '2026-02-01', Warehouse: 'Bengaluru FC', Product: 'Yellow Ritual', Sent_Qty: 80, Sold_Qty: 60, Closing_Stock: 75, In_Transit: 0, Lead_Time_Days: 10 },
  { Month: '2026-03-01', Warehouse: 'Bengaluru FC', Product: 'Yellow Ritual', Sent_Qty: 60, Sold_Qty: 62, Closing_Stock: 73, In_Transit: 0, Lead_Time_Days: 10 },
  { Month: '2026-04-01', Warehouse: 'Bengaluru FC', Product: 'Yellow Ritual', Sent_Qty: 20, Sold_Qty: 45, Closing_Stock: 48, In_Transit: 15, Lead_Time_Days: 10 },
  { Month: '2026-01-01', Warehouse: 'Mumbai FC', Product: 'Minute Mend Balm', Sent_Qty: 150, Sold_Qty: 90, Closing_Stock: 60, In_Transit: 0, Lead_Time_Days: 8 },
  { Month: '2026-02-01', Warehouse: 'Mumbai FC', Product: 'Minute Mend Balm', Sent_Qty: 100, Sold_Qty: 95, Closing_Stock: 65, In_Transit: 0, Lead_Time_Days: 8 },
  { Month: '2026-03-01', Warehouse: 'Mumbai FC', Product: 'Minute Mend Balm', Sent_Qty: 80, Sold_Qty: 84, Closing_Stock: 61, In_Transit: 0, Lead_Time_Days: 8 },
  { Month: '2026-04-01', Warehouse: 'Mumbai FC', Product: 'Minute Mend Balm', Sent_Qty: 20, Sold_Qty: 42, Closing_Stock: 39, In_Transit: 0, Lead_Time_Days: 8 }
];

const els = {
  fileInput: document.getElementById('fileInput'),
  sheetSelect: document.getElementById('sheetSelect'),
  mappingGrid: document.getElementById('mappingGrid'),
  buildBtn: document.getElementById('buildBtn'),
  exportBtn: document.getElementById('exportBtn'),
  filePreview: document.getElementById('filePreview'),
  dataStatus: document.getElementById('dataStatus'),
  warehouseFilter: document.getElementById('warehouseFilter'),
  productFilter: document.getElementById('productFilter'),
  urgencyFilter: document.getElementById('urgencyFilter'),
  alertsList: document.getElementById('alertsList'),
  summaryTableBody: document.getElementById('summaryTableBody'),
  loadSampleBtn: document.getElementById('loadSampleBtn'),
  downloadTemplateBtn: document.getElementById('downloadTemplateBtn'),
  bufferDays: document.getElementById('bufferDays'),
  fallbackLeadDays: document.getElementById('fallbackLeadDays'),
  lookbackPeriods: document.getElementById('lookbackPeriods'),
  kpiGrid: document.getElementById('kpiGrid'),
  uploadMeta: document.getElementById('uploadMeta'),
  selectedFilesList: document.getElementById('selectedFilesList')
};

const state = {
  uploadId: null,
  sheetMap: {},
  currentSheetName: '',
  sampleMode: false,
  exportId: null,
  mappings: {},
  charts: {},
  lastSummary: [],
  fileNames: [],
  mergedUpload: false,
  rawRows: [],
  exportRows: []
};

function createMappingUI(headers = []) {
  els.mappingGrid.innerHTML = '';

  mappingConfig.forEach((config) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';

    const label = document.createElement('label');
    label.className = 'label';
    label.textContent = `${config.label}${config.required ? ' *' : ''}`;
    label.htmlFor = `map-${config.key}`;

    const select = document.createElement('select');
    select.className = 'select';
    select.id = `map-${config.key}`;

    const blankOption = document.createElement('option');
    blankOption.value = '';
    blankOption.textContent = config.required ? 'Select column' : 'Optional';
    select.appendChild(blankOption);

    headers.forEach((header) => {
      const option = document.createElement('option');
      option.value = header;
      option.textContent = header;
      select.appendChild(option);
    });

    const guessed = state.mappings[config.key] || guessColumn(config.key, headers);
    if (guessed) {
      select.value = guessed;
      state.mappings[config.key] = guessed;
    }

    select.addEventListener('change', (event) => {
      state.mappings[config.key] = event.target.value;
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    els.mappingGrid.appendChild(wrapper);
  });
}

function guessColumn(key, headers) {
  const patterns = autoMapPatterns[key] || [];
  for (const pattern of patterns) {
    const match = headers.find((header) => pattern.test(String(header).trim()));
    if (match) return match;
  }
  return '';
}

function setPreview(rows) {
  if (!rows?.length) {
    els.filePreview.textContent = 'No preview available.';
    return;
  }

  const sample = rows
    .slice(0, 4)
    .map((row, index) => `Row ${index + 1}: ${JSON.stringify(row, null, 2)}`)
    .join('\n\n');

  els.filePreview.textContent = sample;
}

function renderUploadMeta({ fileNames = [], merged = false, rowCount = 0, sample = false } = {}) {
  if (sample) {
    els.uploadMeta.innerHTML = [
      '<span class="meta-chip">Sample data</span>',
      `<span class="meta-chip">${sampleRows.length} rows</span>`
    ].join('');
    els.selectedFilesList.textContent = 'Using built-in sample dataset.';
    return;
  }

  if (!fileNames.length) {
    els.uploadMeta.innerHTML = [
      '<span class="meta-chip">No files selected</span>',
      '<span class="meta-chip">CSV merge ready</span>'
    ].join('');
    els.selectedFilesList.textContent = 'No file chosen';
    return;
  }

  const chips = [
    `<span class="meta-chip">${fileNames.length} file${fileNames.length > 1 ? 's' : ''}</span>`,
    `<span class="meta-chip">${rowCount} rows</span>`
  ];

  if (merged) chips.push('<span class="meta-chip">Merged sheet created</span>');

  els.uploadMeta.innerHTML = chips.join('');
  els.selectedFilesList.textContent = fileNames.join('\n');
}

function populateSheetOptions(sheets) {
  els.sheetSelect.innerHTML = '';
  sheets.forEach((sheet) => {
    const option = document.createElement('option');
    option.value = sheet.name;
    option.textContent = `${sheet.name} (${sheet.rowCount} rows)`;
    els.sheetSelect.appendChild(option);
  });
  els.sheetSelect.disabled = !sheets.length;
}

function loadSheetMeta(sheetName) {
  const sheet = state.sheetMap[sheetName];
  if (!sheet) return;

  state.currentSheetName = sheetName;
  createMappingUI(sheet.headers || []);
  setPreview(sheet.preview || []);
  els.dataStatus.textContent = `${sheet.rowCount} rows loaded from ${sheetName}`;
}

async function uploadFiles(files) {
  els.dataStatus.textContent = 'Reading and merging ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '...';

  const result = await buildMergedDashboardRows(files, {
    leadTimeDays: Number(els.fallbackLeadDays.value || 15)
  });

  const sheetName = files.length > 1 ? 'Merged Data (All uploaded files)' : 'Dashboard Data';
  const rows = result.rows || [];

  state.uploadId = 'browser-local-upload';
  state.sampleMode = false;
  state.exportId = null;
  state.exportRows = [];
  state.rawRows = rows;
  state.fileNames = files.map((file) => file.name);
  state.mergedUpload = files.length > 1 || /merge/i.test(result.mode || '');
  state.sheetMap = {
    [sheetName]: {
      name: sheetName,
      headers: TARGET_HEADERS,
      rowCount: rows.length,
      preview: rows.slice(0, 4),
      rows
    }
  };

  state.mappings = {
    date: 'Month',
    warehouse: 'Warehouse',
    product: 'Product',
    sentQty: 'Sent_Qty',
    soldQty: 'Sold_Qty',
    closingStock: 'Closing_Stock',
    inTransit: 'In_Transit',
    leadTimeDays: 'Lead_Time_Days'
  };

  populateSheetOptions([{ name: sheetName, rowCount: rows.length }]);
  els.sheetSelect.value = sheetName;
  loadSheetMeta(sheetName);

  mappingConfig.forEach((config) => {
    const select = document.getElementById('map-' + config.key);
    if (select && state.mappings[config.key]) select.value = state.mappings[config.key];
  });

  renderUploadMeta({
    fileNames: state.fileNames,
    merged: state.mergedUpload,
    rowCount: rows.length,
    sample: false
  });

  if (result.warnings && result.warnings.length) {
    console.warn('Merge warnings:', result.warnings);
  }
}

function loadSampleData() {
  const headers = Object.keys(sampleRows[0]);
  state.sampleMode = true;
  state.uploadId = null;
  state.exportId = null;
  state.fileNames = [];
  state.mergedUpload = false;
  state.sheetMap = {
    'Sample Data': {
      name: 'Sample Data',
      headers,
      rowCount: sampleRows.length,
      preview: sampleRows.slice(0, 4)
    }
  };
  state.currentSheetName = 'Sample Data';
  state.mappings = {
    date: 'Month',
    warehouse: 'Warehouse',
    product: 'Product',
    sentQty: 'Sent_Qty',
    soldQty: 'Sold_Qty',
    closingStock: 'Closing_Stock',
    inTransit: 'In_Transit',
    leadTimeDays: 'Lead_Time_Days'
  };

  populateSheetOptions([{ name: 'Sample Data', rowCount: sampleRows.length }]);
  els.sheetSelect.value = 'Sample Data';
  loadSheetMeta('Sample Data');

  mappingConfig.forEach((config) => {
    const select = document.getElementById(`map-${config.key}`);
    if (select && state.mappings[config.key]) select.value = state.mappings[config.key];
  });

  renderUploadMeta({ sample: true });
  els.fileInput.value = '';
  els.dataStatus.textContent = 'Sample data loaded';
}

function getMappings() {
  const mappings = {};
  mappingConfig.forEach((config) => {
    const select = document.getElementById(`map-${config.key}`);
    mappings[config.key] = select ? select.value : '';
  });
  state.mappings = mappings;
  return mappings;
}

function validateMappings(mappings) {
  const missing = mappingConfig.filter((config) => config.required && !mappings[config.key]);
  if (missing.length) {
    alert(`Please map required columns: ${missing.map((item) => item.label).join(', ')}`);
    return false;
  }
  return true;
}

function getSettings() {
  return {
    bufferDays: Number(els.bufferDays.value || 21),
    fallbackLeadDays: Number(els.fallbackLeadDays.value || 7),
    lookbackPeriods: Number(els.lookbackPeriods.value || 3)
  };
}

function getFilters() {
  return {
    warehouse: els.warehouseFilter.value || 'all',
    product: els.productFilter.value || 'all',
    urgency: els.urgencyFilter.value || 'all'
  };
}

async function requestBuild() {
  const mappings = getMappings();
  if (!validateMappings(mappings)) return;

  const rawRows = state.sampleMode ? sampleRows : state.rawRows;
  if (!rawRows || !rawRows.length) {
    alert('Upload a file or load sample data first.');
    return;
  }

  els.dataStatus.textContent = 'Building dashboard...';

  const settings = getSettings();
  const filters = getFilters();
  const normalizedRows = buildNormalizedRows(rawRows, mappings);

  if (!normalizedRows.length) {
    throw new Error('No valid rows found after applying the selected mappings');
  }

  const summary = buildSummary(normalizedRows, settings);
  const filteredSummary = applyFilters(summary, filters);
  const kpis = generateKpis(filteredSummary, settings);
  const alerts = generateAlerts(filteredSummary, settings);
  const charts = {
    salesTrend: buildSalesTrendSeries(filteredSummary),
    stockByWarehouse: buildStockByWarehouseSeries(filteredSummary),
    productMix: buildProductMixSeries(filteredSummary)
  };
  const filterOptions = buildFilterOptions(summary);

  state.exportId = 'browser-local-export';
  state.exportRows = createExportRows(filteredSummary);
  state.lastSummary = filteredSummary || [];

  populateFilters(filterOptions);
  renderKpis(kpis);
  renderSummaryTable(filteredSummary || []);
  renderAlerts(alerts || []);
  renderCharts(charts || {});
  els.dataStatus.textContent = filteredSummary.length + ' warehouse-product rows in view';
}

function fillSelect(select, values, firstLabel) {
  const current = select.value || 'all';
  select.innerHTML = `<option value="all">${firstLabel}</option>`;

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  select.value = values.includes(current) ? current : 'all';
}

function populateFilters(filterOptions = {}) {
  fillSelect(els.warehouseFilter, filterOptions.warehouses || [], 'All warehouses');
  fillSelect(els.productFilter, filterOptions.products || [], 'All products');
}

function compactNumber(num) {
  const value = Number(num || 0);
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: value >= 100 ? 0 : 1
  }).format(value);
}

function formatDecimal(num, digits = 1) {
  const value = Number(num || 0);
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderKpis(kpis) {
  const cards = [
    {
      label: 'Total available stock',
      value: compactNumber(kpis.totalStock),
      sub: `In transit not included here: ${compactNumber(kpis.totalInTransit)}`
    },
    {
      label: 'Avg daily sales',
      value: formatDecimal(kpis.totalAvgDailySales, 1),
      sub: `Estimated from last ${compactNumber(kpis.lookbackPeriods || 3)} period(s)`
    },
    {
      label: 'Warehouses at risk',
      value: compactNumber(kpis.atRisk),
      sub: `${compactNumber(kpis.totalRecommended)} units need planning soon`
    },
    {
      label: 'Estimated stock cover',
      value: Number.isFinite(kpis.medianCover) ? `${formatDecimal(kpis.medianCover, 0)} d` : '—',
      sub: 'Median across current view'
    }
  ];

  els.kpiGrid.innerHTML = cards
    .map(
      (item) => `
        <div class="panel kpi">
          <div class="kpi-label">${item.label}</div>
          <div class="kpi-value">${item.value}</div>
          <div class="kpi-sub">${item.sub}</div>
        </div>
      `
    )
    .join('');
}

function badgeHtml(status) {
  const map = {
    critical: ['Critical', 'red'],
    warning: ['Warning', 'orange'],
    healthy: ['Healthy', 'green']
  };
  const [label, color] = map[status] || ['Unknown', 'blue'];
  return `<span class="badge ${color}">${label}</span>`;
}

function renderSummaryTable(rows) {
  if (!rows.length) {
    els.summaryTableBody.innerHTML = '<tr><td colspan="11"><div class="empty-state">No rows match current filters.</div></td></tr>';
    return;
  }

  els.summaryTableBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.warehouse)}</td>
          <td>${escapeHtml(row.product)}</td>
          <td>${formatDate(row.latestDate)}</td>
          <td>${compactNumber(row.availableStock)}</td>
          <td>${compactNumber(row.inTransit)}</td>
          <td>${formatDecimal(row.avgSalesPerPeriod, 1)}</td>
          <td>${formatDecimal(row.avgDailySales, 2)}</td>
          <td>${Number.isFinite(row.daysCover) ? `${formatDecimal(row.daysCover, 0)} days` : 'No sales trend'}</td>
          <td>${compactNumber(row.leadTimeDays)} d</td>
          <td>${badgeHtml(row.status)}</td>
          <td>${compactNumber(row.recommendedDispatch)}</td>
        </tr>
      `
    )
    .join('');
}

function renderAlerts(alerts) {
  if (!alerts.length) {
    els.alertsList.innerHTML = '<div class="empty-state">No urgent dispatch alerts in current view.</div>';
    return;
  }

  els.alertsList.innerHTML = alerts
    .map((alertItem) => {
      const statusClass = alertItem.status === 'critical' ? 'red' : 'orange';
      return `
        <div class="alert-item">
          <div class="alert-top">
            <div class="alert-title">${escapeHtml(alertItem.warehouse)} · ${escapeHtml(alertItem.product)}</div>
            <span class="badge ${statusClass}">${alertItem.tone}</span>
          </div>
          <p>
            Stock cover is <strong>${Number.isFinite(alertItem.daysCover) ? `${formatDecimal(alertItem.daysCover, 0)} days` : 'not available'}</strong>.
            Your protection threshold is <strong>${compactNumber(alertItem.threshold)} days</strong>
            (${compactNumber(alertItem.leadTimeDays)} lead time + ${compactNumber(alertItem.bufferDays)} safety buffer).
            Recommended dispatch: <strong>${compactNumber(alertItem.recommendedDispatch)} units</strong>.
          </p>
        </div>
      `;
    })
    .join('');
}

function destroyChart(name) {
  if (state.charts[name]) {
    state.charts[name].destroy();
    state.charts[name] = null;
  }
}

function chartCommonOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#dbe1ef' } },
      tooltip: {
        backgroundColor: '#111826',
        titleColor: '#fff',
        bodyColor: '#dbe1ef',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1
      }
    },
    scales: {
      x: {
        ticks: { color: '#a9b0bf' },
        grid: { color: 'rgba(255,255,255,0.04)' }
      },
      y: {
        ticks: { color: '#a9b0bf' },
        grid: { color: 'rgba(255,255,255,0.05)' }
      }
    }
  };
}

function renderCharts(charts) {
  renderSalesTrendChart(charts.salesTrend || { labels: [], values: [] });
  renderStockByWarehouseChart(charts.stockByWarehouse || { labels: [], values: [] });
  renderProductMixChart(charts.productMix || { labels: [], values: [] });
}

function renderSalesTrendChart(series) {
  destroyChart('salesTrend');
  state.charts.salesTrend = new Chart(document.getElementById('salesTrendChart'), {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [
        {
          label: 'Sold qty',
          data: series.values,
          borderColor: '#ffd84d',
          backgroundColor: 'rgba(255,216,77,0.12)',
          tension: 0.28,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 5
        }
      ]
    },
    options: chartCommonOptions()
  });
}

function renderStockByWarehouseChart(series) {
  destroyChart('stockByWarehouse');
  state.charts.stockByWarehouse = new Chart(document.getElementById('stockByWarehouseChart'), {
    type: 'bar',
    data: {
      labels: series.labels,
      datasets: [
        {
          label: 'Available stock',
          data: series.values,
          backgroundColor: 'rgba(142,197,255,0.65)',
          borderColor: '#8ec5ff',
          borderWidth: 1.2,
          borderRadius: 12
        }
      ]
    },
    options: chartCommonOptions()
  });
}

function renderProductMixChart(series) {
  destroyChart('productMix');
  state.charts.productMix = new Chart(document.getElementById('productMixChart'), {
    type: 'doughnut',
    data: {
      labels: series.labels,
      datasets: [
        {
          data: series.values,
          backgroundColor: [
            'rgba(255,216,77,0.85)',
            'rgba(142,197,255,0.82)',
            'rgba(57,196,127,0.78)',
            'rgba(255,174,66,0.82)',
            'rgba(255,111,111,0.8)',
            'rgba(194,173,255,0.82)'
          ],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#dbe1ef', padding: 16 }
        },
        tooltip: {
          backgroundColor: '#111826',
          titleColor: '#fff',
          bodyColor: '#dbe1ef'
        }
      }
    }
  });
}

function downloadTemplate() {
  const rows = [
    {
      Month: '2026-04-01',
      Warehouse: 'Delhi FC',
      Product: 'Spoil Yourself',
      Sent_Qty: 120,
      Sold_Qty: 110,
      Closing_Stock: 210,
      In_Transit: 20,
      Lead_Time_Days: 7
    },
    {
      Month: '2026-04-01',
      Warehouse: 'Mumbai FC',
      Product: 'Reset Kit',
      Sent_Qty: 80,
      Sold_Qty: 95,
      Closing_Stock: 140,
      In_Transit: 0,
      Lead_Time_Days: 8
    }
  ];

  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(',')].concat(
    rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? '')).join(','))
  );

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'warehouse_dashboard_template.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function exportSummary() {
  if (!state.exportRows || !state.exportRows.length) {
    alert('Build the dashboard first.');
    return;
  }

  const rows = state.exportRows;
  const headers = Object.keys(rows[0] || {});
  const csvLines = [headers.join(',')].concat(
    rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? '')).join(','))
  );
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'warehouse_summary_export.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

els.fileInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  try {
    await uploadFiles(files);
  } catch (error) {
    console.error(error);
    alert(error.message || 'Upload failed');
    els.dataStatus.textContent = 'Upload failed';
  }
});

els.sheetSelect.addEventListener('change', () => {
  loadSheetMeta(els.sheetSelect.value);
});

els.loadSampleBtn.addEventListener('click', loadSampleData);
els.downloadTemplateBtn.addEventListener('click', downloadTemplate);
els.exportBtn.addEventListener('click', exportSummary);
els.buildBtn.addEventListener('click', async () => {
  try {
    await requestBuild();
  } catch (error) {
    console.error(error);
    alert(error.message || 'Build failed');
    els.dataStatus.textContent = 'Build failed';
  }
});

[els.warehouseFilter, els.productFilter, els.urgencyFilter].forEach((select) => {
  select.addEventListener('change', async () => {
    if (!state.uploadId && !state.sampleMode) return;
    try {
      await requestBuild();
    } catch (error) {
      console.error(error);
      alert(error.message || 'Failed to apply filters');
      els.dataStatus.textContent = 'Filter update failed';
    }
  });
});

createMappingUI([]);
renderUploadMeta();
