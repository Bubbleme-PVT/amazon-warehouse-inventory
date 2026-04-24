
import * as XLSX from 'xlsx';
import { buildMergedDashboardRows, exportRowsToWorkbook, TARGET_HEADERS } from './mergeEngine.js';

const Chart = window.Chart;
const THEME_STORAGE_KEY = 'warehouse-ui-theme-choice';
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(choice) {
  const resolved = choice === 'system' ? (systemThemeQuery.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeChoice === choice);
  });
}

function selectedThemeChoice() {
  return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
}

function setupThemeControls() {
  const current = selectedThemeChoice();
  applyTheme(current);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const choice = button.dataset.themeChoice || 'system';
      localStorage.setItem(THEME_STORAGE_KEY, choice);
      applyTheme(choice);
      if (typeof renderEverything === 'function') renderEverything();
    });
  });
  systemThemeQuery.addEventListener('change', () => {
    if (selectedThemeChoice() === 'system') {
      applyTheme('system');
      if (typeof renderEverything === 'function') renderEverything();
    }
  });
}


const mappingConfig = [
      { key: 'date', label: 'Date / Month', required: true },
      { key: 'warehouse', label: 'Warehouse', required: true },
      { key: 'product', label: 'Product', required: true },
      { key: 'soldQty', label: 'Sold Qty', required: true },
      { key: 'closingStock', label: 'Closing Stock / Available', required: true },
      { key: 'inTransit', label: 'In Transit Qty', required: false },
      { key: 'sentQty', label: 'Sent Qty', required: false },
      { key: 'leadTimeDays', label: 'Lead Time Days', required: false },
      { key: 'fcCode', label: 'FC Code', required: false },
      { key: 'city', label: 'City', required: false },
      { key: 'accountSource', label: 'Account Source', required: false },
      { key: 'confidence', label: 'Data Confidence', required: false },
      { key: 'notes', label: 'Notes', required: false }
    ];

    const autoPatterns = {
      date: [/^month$/i, /^date$/i, /period/i, /month|date/i],
      warehouse: [/^warehouse$/i, /warehouse/i, /location/i, /fc/i],
      product: [/^product$/i, /product/i, /^sku$/i, /item/i, /title/i, /name/i],
      soldQty: [/sold/i, /sales/i, /units sold/i],
      closingStock: [/closing/i, /available/i, /stock/i, /balance/i, /inventory/i, /remaining/i],
      inTransit: [/in transit/i, /transit/i, /receiving/i],
      sentQty: [/sent/i, /dispatch/i, /shipped/i, /inward/i],
      leadTimeDays: [/lead/i, /lead time/i],
      fcCode: [/fc_code/i, /fc code/i, /code/i],
      city: [/^city$/i],
      accountSource: [/account/i, /source/i],
      confidence: [/confidence/i],
      notes: [/notes?/i]
    };

    const preferredSheetNames = [
      'Dashboard_Upload_BestEffort',
      'Dashboard_Upload_Strict',
      'Dashboard Upload BestEffort',
      'Dashboard Upload Strict',
      'Dashboard_Upload',
      'Dashboard'
    ];

    const els = {
      fileInput: document.getElementById('fileInput'),
      sheetSelect: document.getElementById('sheetSelect'),
      mappingGrid: document.getElementById('mappingGrid'),
      filePreview: document.getElementById('filePreview'),
      loadSampleBtn: document.getElementById('loadSampleBtn'),
      downloadTemplateBtn: document.getElementById('downloadTemplateBtn'),
      buildBtn: document.getElementById('buildBtn'),
      exportBtn: document.getElementById('exportBtn'),
      bufferDays: document.getElementById('bufferDays'),
      fallbackLeadDays: document.getElementById('fallbackLeadDays'),
      lookbackPeriods: document.getElementById('lookbackPeriods'),
      minDispatchQty: document.getElementById('minDispatchQty'),
      warehouseFilter: document.getElementById('warehouseFilter'),
      productFilter: document.getElementById('productFilter'),
      planFilter: document.getElementById('planFilter'),
      confidenceFilter: document.getElementById('confidenceFilter'),
      kpiGrid: document.getElementById('kpiGrid'),
      statusChip: document.getElementById('statusChip'),
      ruleSummary: document.getElementById('ruleSummary'),
      readyList: document.getElementById('readyList'),
      holdList: document.getElementById('holdList'),
      readyBadge: document.getElementById('readyBadge'),
      holdBadge: document.getElementById('holdBadge'),
      warehouseTableBody: document.getElementById('warehouseTableBody'),
      skuTableBody: document.getElementById('skuTableBody'),
      dataHealthList: document.getElementById('dataHealthList')
    };

    const state = {
      workbook: null,
      sheetRows: [],
      rawObjects: [],
      headers: [],
      mappings: {},
      validRows: [],
      skuSummaries: [],
      warehousePlans: [],
      filteredSkuSummaries: [],
      filteredWarehousePlans: [],
      charts: {},
      health: {
        rawRows: 0,
        validRows: 0,
        droppedBlank: 0,
        droppedHeaderLike: 0,
        selectedSheet: '',
        fileName: '',
        fileCount: 0,
        mergeMode: '',
        warningCount: 0
      },
      mergeAuditRows: [],
      mergeWarnings: [],
      updatedMasterRows: []
    };

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function parseNumber(value) {
      if (value === null || value === undefined || value === '') return 0;
      if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
      const text = String(value).replace(/,/g, '').trim();
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function parseDateValue(value) {
      if (value instanceof Date && !isNaN(value)) return value;
      if (typeof value === 'number') {
        const epoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(epoch.getTime() + value * 86400000);
      }
      const text = String(value ?? '').trim();
      if (!text) return null;
      const parsed = new Date(text);
      return isNaN(parsed) ? null : parsed;
    }

    function formatDate(date) {
      if (!(date instanceof Date) || isNaN(date)) return '—';
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function compactNumber(num) {
      const value = Number(num || 0);
      return new Intl.NumberFormat('en-IN', { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value);
    }

    function formatDecimal(num, digits = 1) {
      const value = Number(num || 0);
      return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
    }

    function average(arr) {
      return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    }

    function median(arr) {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function unique(values) {
      return [...new Set(values)];
    }

    function createMappingUI(headers = []) {
      els.mappingGrid.innerHTML = '';
      mappingConfig.forEach(config => {
        const wrapper = document.createElement('div');
        wrapper.className = 'field';
        const label = document.createElement('label');
        label.htmlFor = `map-${config.key}`;
        label.textContent = `${config.label}${config.required ? ' *' : ''}`;
        const select = document.createElement('select');
        select.className = 'select';
        select.id = `map-${config.key}`;

        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = config.required ? 'Select column' : 'Optional';
        select.appendChild(blank);

        headers.forEach(header => {
          const option = document.createElement('option');
          option.value = header;
          option.textContent = header;
          select.appendChild(option);
        });

        const guessed = guessHeader(config.key, headers);
        if (guessed) {
          state.mappings[config.key] = guessed;
          select.value = guessed;
        }

        select.addEventListener('change', (e) => {
          state.mappings[config.key] = e.target.value;
        });

        wrapper.appendChild(label);
        wrapper.appendChild(select);
        els.mappingGrid.appendChild(wrapper);
      });
    }

    function guessHeader(key, headers) {
      const patterns = autoPatterns[key] || [];
      for (const pattern of patterns) {
        const found = headers.find(h => pattern.test(String(h).trim()));
        if (found) return found;
      }
      return '';
    }

    function scoreRowAsHeader(row) {
      if (!row || !row.length) return 0;
      const joined = row.map(cell => String(cell ?? '').trim()).filter(Boolean);
      if (!joined.length) return 0;
      let score = 0;
      const lowered = joined.map(v => v.toLowerCase());
      Object.values(autoPatterns).flat().forEach(pattern => {
        if (lowered.some(cell => pattern.test(cell))) score += 1;
      });
      return score;
    }

    function detectHeaderRowIndex(matrix) {
      let bestIndex = 0;
      let bestScore = -1;
      const maxRows = Math.min(matrix.length, 20);
      for (let i = 0; i < maxRows; i++) {
        const score = scoreRowAsHeader(matrix[i]);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      return bestIndex;
    }

    function parseSheetToObjects(sheet) {
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const headerIndex = detectHeaderRowIndex(matrix);
      const headerRow = (matrix[headerIndex] || []).map(h => String(h ?? '').trim());
      const objects = [];
      for (let i = headerIndex + 1; i < matrix.length; i++) {
        const row = matrix[i] || [];
        const obj = {};
        let hasAny = false;
        headerRow.forEach((header, idx) => {
          const cleanHeader = header || `Column_${idx + 1}`;
          const value = row[idx] ?? '';
          obj[cleanHeader] = value;
          if (String(value).trim() !== '') hasAny = true;
        });
        if (hasAny) objects.push(obj);
      }
      return {
        objects,
        headers: headerRow.filter(Boolean),
        headerIndex,
        previewRows: objects.slice(0, 4)
      };
    }

    function preferredSheet(sheetNames) {
      for (const preferred of preferredSheetNames) {
        const exact = sheetNames.find(name => name.toLowerCase() === preferred.toLowerCase());
        if (exact) return exact;
      }
      const fuzzy = sheetNames.find(name => /dashboard_upload_besteffort|dashboard upload besteffort/i.test(name));
      if (fuzzy) return fuzzy;
      const generic = sheetNames.find(name => /dashboard/i.test(name));
      return generic || sheetNames[0] || '';
    }

    function populateSheetOptions(sheetNames) {
      els.sheetSelect.innerHTML = '';
      sheetNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        els.sheetSelect.appendChild(option);
      });
    }

    function setPreview(previewRows) {
      if (!previewRows || !previewRows.length) {
        els.filePreview.textContent = 'No preview available.';
        return;
      }
      els.filePreview.textContent = previewRows.map((row, index) => `Row ${index + 1}: ${JSON.stringify(row, null, 2)}`).join('\n\n');
    }

    function renderDataHealth(extra = {}) {
      const health = { ...state.health, ...extra };
      const items = [
        `Files: ${health.fileCount || (health.fileName ? 1 : 0) || '—'}`,
        `File: ${health.fileName || '—'}`,
        `View: ${health.selectedSheet || '—'}`,
        `Mode: ${health.mergeMode || '—'}`,
        `Raw rows: ${compactNumber(health.rawRows || 0)}`,
        `Valid rows: ${compactNumber(health.validRows || 0)}`,
        `Dropped blank: ${compactNumber(health.droppedBlank || 0)}`,
        `Dropped header-like: ${compactNumber(health.droppedHeaderLike || 0)}`,
        `Warnings: ${compactNumber(health.warningCount || 0)}`
      ];
      els.dataHealthList.innerHTML = items.map(text => `<span class="tiny-item">${escapeHtml(text)}</span>`).join('');
    }

    
async function readWorkbookFromFile(inputFiles) {
  const files = Array.isArray(inputFiles)
    ? inputFiles
    : Array.from(inputFiles || []).filter(Boolean);
  if (!files.length) return;

  try {
    els.statusChip.textContent = `Reading ${files.length} file${files.length > 1 ? 's' : ''}...`;
    const result = await buildMergedDashboardRows(files, {
      leadTimeDays: Math.max(0, parseNumber(els.fallbackLeadDays.value) || 15)
    });

    state.workbook = null;
    state.sheetRows = [];
    state.rawObjects = result.rows || [];
    state.headers = TARGET_HEADERS.slice();
    state.validRows = [];
    state.skuSummaries = [];
    state.warehousePlans = [];
    state.filteredSkuSummaries = [];
    state.filteredWarehousePlans = [];
    state.mergeAuditRows = result.auditRows || [];
    state.mergeWarnings = result.warnings || [];
    state.updatedMasterRows = /Master XLSX updated/i.test(result.mode || '') ? (result.rows || []) : [];

    state.health.fileName = files.map(file => file.name).join(', ');
    state.health.fileCount = files.length;
    state.health.selectedSheet = result.mode || 'Merged Data';
    state.health.mergeMode = result.mode || 'Merged Data';
    state.health.rawRows = state.rawObjects.length;
    state.health.validRows = 0;
    state.health.droppedBlank = 0;
    state.health.droppedHeaderLike = 0;
    state.health.warningCount = state.mergeWarnings.length;

    state.mappings = {
      date: 'Month',
      warehouse: 'Warehouse',
      product: 'Product',
      soldQty: 'Sold_Qty',
      closingStock: 'Closing_Stock',
      inTransit: 'In_Transit',
      sentQty: 'Sent_Qty',
      leadTimeDays: 'Lead_Time_Days',
      fcCode: '',
      city: '',
      accountSource: '',
      confidence: '',
      notes: ''
    };

    createMappingUI(state.headers);
    mappingConfig.forEach(config => {
      const select = document.getElementById(`map-${config.key}`);
      if (select && state.mappings[config.key]) select.value = state.mappings[config.key];
    });

    els.sheetSelect.innerHTML = `<option value="merged">${escapeHtml(result.mode || 'Merged Data')} (${compactNumber(state.rawObjects.length)} rows)</option>`;
    els.sheetSelect.disabled = true;
    setPreview(state.rawObjects.slice(0, 4));
    renderDataHealth();
    els.statusChip.textContent = `${compactNumber(state.rawObjects.length)} rows ready`;
    els.exportBtn.textContent = state.updatedMasterRows.length ? 'Download updated XLSX' : 'Export planner workbook';
  } catch (error) {
    console.error(error);
    alert(error?.message || 'Could not read the uploaded files.');
    els.statusChip.textContent = 'Upload failed';
  }
}

function readSelectedSheet() {
  if (!state.rawObjects.length) return;
  createMappingUI(state.headers);
  setPreview(state.rawObjects.slice(0, 4));
  renderDataHealth();
}


    function loadSampleData() {
      const sample = [
        { Month: '2026-01-01', Warehouse: 'Bangalore (BLR7)', Product: 'Spoil Yourself', Sold_Qty: 95, Closing_Stock: 140, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },
        { Month: '2026-02-01', Warehouse: 'Bangalore (BLR7)', Product: 'Spoil Yourself', Sold_Qty: 101, Closing_Stock: 110, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },
        { Month: '2026-03-01', Warehouse: 'Bangalore (BLR7)', Product: 'Spoil Yourself', Sold_Qty: 132, Closing_Stock: 70, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },
        { Month: '2026-04-01', Warehouse: 'Bangalore (BLR7)', Product: 'Spoil Yourself', Sold_Qty: 88, Closing_Stock: 18, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },

        { Month: '2026-01-01', Warehouse: 'Bangalore (BLR7)', Product: 'Reset Kit', Sold_Qty: 41, Closing_Stock: 84, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },
        { Month: '2026-02-01', Warehouse: 'Bangalore (BLR7)', Product: 'Reset Kit', Sold_Qty: 44, Closing_Stock: 62, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },
        { Month: '2026-03-01', Warehouse: 'Bangalore (BLR7)', Product: 'Reset Kit', Sold_Qty: 45, Closing_Stock: 37, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },
        { Month: '2026-04-01', Warehouse: 'Bangalore (BLR7)', Product: 'Reset Kit', Sold_Qty: 39, Closing_Stock: 16, In_Transit: 0, Lead_Time_Days: 15, City: 'Bangalore', Data_Confidence: 'High' },

        { Month: '2026-01-01', Warehouse: 'Gurgaon (DEL4)', Product: 'Minute Mend Balm', Sold_Qty: 22, Closing_Stock: 62, In_Transit: 0, Lead_Time_Days: 15, City: 'Gurgaon', Data_Confidence: 'Medium' },
        { Month: '2026-02-01', Warehouse: 'Gurgaon (DEL4)', Product: 'Minute Mend Balm', Sold_Qty: 28, Closing_Stock: 44, In_Transit: 0, Lead_Time_Days: 15, City: 'Gurgaon', Data_Confidence: 'Medium' },
        { Month: '2026-03-01', Warehouse: 'Gurgaon (DEL4)', Product: 'Minute Mend Balm', Sold_Qty: 31, Closing_Stock: 21, In_Transit: 0, Lead_Time_Days: 15, City: 'Gurgaon', Data_Confidence: 'Medium' },
        { Month: '2026-04-01', Warehouse: 'Gurgaon (DEL4)', Product: 'Minute Mend Balm', Sold_Qty: 18, Closing_Stock: 8, In_Transit: 20, Lead_Time_Days: 15, City: 'Gurgaon', Data_Confidence: 'Medium' }
      ];
      state.workbook = null;
      state.rawObjects = sample;
      state.headers = Object.keys(sample[0]);
      state.health.fileName = 'Sample';
      state.health.selectedSheet = 'Sample';
      state.health.rawRows = sample.length;
      state.health.validRows = 0;
      state.health.droppedBlank = 0;
      state.health.droppedHeaderLike = 0;
      createMappingUI(state.headers);
      state.mappings = {
        date: 'Month',
        warehouse: 'Warehouse',
        product: 'Product',
        soldQty: 'Sold_Qty',
        closingStock: 'Closing_Stock',
        inTransit: 'In_Transit',
        leadTimeDays: 'Lead_Time_Days',
        city: 'City',
        confidence: 'Data_Confidence'
      };
      mappingConfig.forEach(config => {
        const select = document.getElementById(`map-${config.key}`);
        if (select && state.mappings[config.key]) select.value = state.mappings[config.key];
      });
      state.mergeAuditRows = [];
      state.mergeWarnings = [];
      state.updatedMasterRows = [];
      state.health.fileCount = 1;
      state.health.mergeMode = 'Sample data';
      state.health.warningCount = 0;
      els.sheetSelect.innerHTML = '<option value="Sample">Sample</option>';
      els.sheetSelect.disabled = true;
      setPreview(sample.slice(0, 4));
      renderDataHealth();
      els.exportBtn.textContent = 'Export planner workbook';
      els.statusChip.textContent = 'Sample loaded';
    }

    function looksLikeRepeatedHeader(row) {
      const warehouse = String(row.warehouse || '').trim().toLowerCase();
      const product = String(row.product || '').trim().toLowerCase();
      const dateText = String(row.rawDate || '').trim().toLowerCase();
      const suspects = ['warehouse', 'product', 'month', 'date', 'sold_qty', 'closing_stock', 'in_transit', 'lead_time_days'];
      return suspects.includes(warehouse) || suspects.includes(product) || suspects.includes(dateText);
    }

    function validateMappings() {
      const missing = mappingConfig.filter(x => x.required).filter(x => !state.mappings[x.key]);
      if (missing.length) {
        alert(`Map these required columns first: ${missing.map(x => x.label).join(', ')}`);
        return false;
      }
      return true;
    }

    function getMapped(row, key) {
      const header = state.mappings[key];
      return header ? row[header] : '';
    }

    function buildValidRows() {
      const valid = [];
      let droppedBlank = 0;
      let droppedHeaderLike = 0;

      state.rawObjects.forEach(source => {
        const row = {
          rawDate: getMapped(source, 'date'),
          date: parseDateValue(getMapped(source, 'date')),
          warehouse: String(getMapped(source, 'warehouse') || '').trim(),
          product: String(getMapped(source, 'product') || '').trim(),
          soldQty: parseNumber(getMapped(source, 'soldQty')),
          closingStock: parseNumber(getMapped(source, 'closingStock')),
          inTransit: parseNumber(getMapped(source, 'inTransit')),
          sentQty: parseNumber(getMapped(source, 'sentQty')),
          leadTimeDays: Math.max(0, parseNumber(getMapped(source, 'leadTimeDays'))),
          fcCode: String(getMapped(source, 'fcCode') || '').trim(),
          city: String(getMapped(source, 'city') || '').trim(),
          accountSource: String(getMapped(source, 'accountSource') || '').trim(),
          confidence: String(getMapped(source, 'confidence') || '').trim() || 'Unknown',
          notes: String(getMapped(source, 'notes') || '').trim()
        };

        const hasRequiredSignal = row.warehouse || row.product || row.rawDate || row.soldQty || row.closingStock || row.inTransit;
        if (!hasRequiredSignal) {
          droppedBlank += 1;
          return;
        }
        if (looksLikeRepeatedHeader(row)) {
          droppedHeaderLike += 1;
          return;
        }
        if (!row.warehouse || !row.product) {
          droppedBlank += 1;
          return;
        }
        valid.push(row);
      });

      state.validRows = valid;
      state.health.validRows = valid.length;
      state.health.droppedBlank = droppedBlank;
      state.health.droppedHeaderLike = droppedHeaderLike;
      renderDataHealth();
      return valid;
    }

    function calculatePeriodDays(rows) {
      const sorted = rows.filter(r => r.date).sort((a, b) => a.date - b.date);
      if (sorted.length < 2) return 30;
      const diffs = [];
      for (let i = 1; i < sorted.length; i++) {
        const diff = Math.max(1, Math.round((sorted[i].date - sorted[i - 1].date) / 86400000));
        diffs.push(diff);
      }
      return Math.max(1, Math.round(average(diffs)));
    }

    function getSeverity(daysCover, threshold) {
      if (!Number.isFinite(daysCover)) return 'healthy';
      if (daysCover <= threshold) return 'critical';
      if (daysCover <= threshold + 10) return 'warning';
      return 'healthy';
    }

    function confidenceRank(value) {
      const v = String(value || '').toLowerCase();
      if (v === 'low') return 0;
      if (v === 'medium') return 1;
      if (v === 'high') return 2;
      return -1;
    }

    function worstSeverity(list) {
      if (list.includes('critical')) return 'critical';
      if (list.includes('warning')) return 'warning';
      return 'healthy';
    }

    function severityBadge(severity) {
      if (severity === 'critical') return '<span class="status-badge status-critical">Critical</span>';
      if (severity === 'warning') return '<span class="status-badge status-warning">Warning</span>';
      return '<span class="status-badge status-healthy">Healthy</span>';
    }

    function confidenceBadge(value) {
      const v = value || 'Unknown';
      if (v === 'High') return '<span class="status-badge status-healthy">High</span>';
      if (v === 'Medium') return '<span class="status-badge status-warning">Medium</span>';
      if (v === 'Low') return '<span class="status-badge status-critical">Low</span>';
      return '<span class="status-badge status-hold">Unknown</span>';
    }

    function buildSummaries() {
      const rows = buildValidRows();
      if (!rows.length) {
        alert('No valid data rows were found after cleaning.');
        return;
      }

      const lookback = Math.max(1, parseNumber(els.lookbackPeriods.value) || 3);
      const bufferDays = Math.max(0, parseNumber(els.bufferDays.value) || 21);
      const fallbackLeadDays = Math.max(0, parseNumber(els.fallbackLeadDays.value) || 15);
      const minDispatchQty = Math.max(1, parseNumber(els.minDispatchQty.value) || 60);

      const skuGroups = new Map();
      rows.forEach(row => {
        const key = `${row.warehouse}|||${row.product}`;
        if (!skuGroups.has(key)) skuGroups.set(key, []);
        skuGroups.get(key).push(row);
      });

      const skuSummaries = [];
      skuGroups.forEach((groupRows, key) => {
        const sorted = [...groupRows].sort((a, b) => {
          const da = a.date ? a.date.getTime() : 0;
          const db = b.date ? b.date.getTime() : 0;
          return da - db;
        });
        const latest = sorted[sorted.length - 1];
        const trailing = sorted.slice(-lookback);
        const avgSalesPerPeriod = average(trailing.map(r => r.soldQty));
        const periodDays = calculatePeriodDays(trailing);
        const avgDailySales = periodDays > 0 ? avgSalesPerPeriod / periodDays : 0;
        const effectiveStock = latest.closingStock + latest.inTransit;
        const leadTimeDays = latest.leadTimeDays || fallbackLeadDays;
        const thresholdDays = leadTimeDays + bufferDays;
        const daysCover = avgDailySales > 0 ? effectiveStock / avgDailySales : Infinity;
        const severity = getSeverity(daysCover, thresholdDays);
        const rawNeed = Math.max(0, Math.ceil((avgDailySales * thresholdDays) - effectiveStock));
        const confidenceValues = unique(sorted.map(r => r.confidence || 'Unknown'));
        let groupConfidence = 'Unknown';
        if (confidenceValues.length) {
          const rank = Math.min(...confidenceValues.map(confidenceRank));
          groupConfidence = rank === 0 ? 'Low' : rank === 1 ? 'Medium' : rank === 2 ? 'High' : 'Unknown';
        }

        skuSummaries.push({
          key,
          warehouse: latest.warehouse,
          city: latest.city || '—',
          fcCode: latest.fcCode || '—',
          product: latest.product,
          latestDate: latest.date,
          availableStock: latest.closingStock,
          inTransit: latest.inTransit,
          sentQty: latest.sentQty,
          avgSalesPerPeriod,
          avgDailySales,
          daysCover,
          leadTimeDays,
          thresholdDays,
          severity,
          rawNeed,
          confidence: groupConfidence,
          accountSource: latest.accountSource || '—',
          notes: latest.notes || '',
          allRows: sorted
        });
      });

      const warehouseGroups = new Map();
      skuSummaries.forEach(item => {
        if (!warehouseGroups.has(item.warehouse)) warehouseGroups.set(item.warehouse, []);
        warehouseGroups.get(item.warehouse).push(item);
      });

      const warehousePlans = [];
      warehouseGroups.forEach((items, warehouse) => {
        const totalAvailable = items.reduce((sum, item) => sum + item.availableStock, 0);
        const totalTransit = items.reduce((sum, item) => sum + item.inTransit, 0);
        const totalAvgDaily = items.reduce((sum, item) => sum + item.avgDailySales, 0);
        const rawNeedTotal = items.reduce((sum, item) => sum + item.rawNeed, 0);
        const readyDispatch = rawNeedTotal >= minDispatchQty ? rawNeedTotal : 0;
        const gapToMinimum = rawNeedTotal > 0 && rawNeedTotal < minDispatchQty ? (minDispatchQty - rawNeedTotal) : 0;
        const severities = items.map(item => item.severity);
        const severity = worstSeverity(severities);
        let action = 'healthy';
        if (rawNeedTotal === 0) action = 'healthy';
        else if (rawNeedTotal < minDispatchQty) action = 'hold';
        else if (severity === 'critical') action = 'dispatch_now';
        else action = 'dispatch_soon';

        const confidences = items.map(item => item.confidence);
        let confidence = 'Unknown';
        if (confidences.length) {
          const rank = Math.min(...confidences.map(confidenceRank));
          confidence = rank === 0 ? 'Low' : rank === 1 ? 'Medium' : rank === 2 ? 'High' : 'Unknown';
        }

        const latestDate = items
          .map(item => item.latestDate)
          .filter(Boolean)
          .sort((a, b) => b - a)[0] || null;

        const topDrivers = [...items]
          .sort((a, b) => b.rawNeed - a.rawNeed)
          .filter(item => item.rawNeed > 0)
          .slice(0, 3)
          .map(item => ({ product: item.product, rawNeed: item.rawNeed }));

        warehousePlans.push({
          warehouse,
          city: items[0].city || '—',
          fcCode: items[0].fcCode || '—',
          latestDate,
          totalAvailable,
          totalTransit,
          totalAvgDaily,
          rawNeedTotal,
          readyDispatch,
          gapToMinimum,
          severity,
          action,
          confidence,
          topDrivers,
          skuCount: items.length,
          atRiskSkuCount: items.filter(item => item.rawNeed > 0).length
        });

        items.forEach(item => {
          item.warehouseRawNeed = rawNeedTotal;
          item.warehouseReadyDispatch = readyDispatch;
          item.warehouseAction = action;
          item.warehouseGapToMinimum = gapToMinimum;
        });
      });

      warehousePlans.sort((a, b) => {
        const order = { dispatch_now: 0, dispatch_soon: 1, hold: 2, healthy: 3 };
        const first = order[a.action] - order[b.action];
        if (first !== 0) return first;
        return b.rawNeedTotal - a.rawNeedTotal;
      });

      state.skuSummaries = skuSummaries;
      state.warehousePlans = warehousePlans;
      state.filteredSkuSummaries = [...skuSummaries];
      state.filteredWarehousePlans = [...warehousePlans];
    }

    function fillSelect(select, values, firstLabel) {
      const current = select.value || 'all';
      select.innerHTML = `<option value="all">${firstLabel}</option>`;
      values.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
      select.value = values.includes(current) ? current : 'all';
    }

    function populateFilters() {
      const warehouses = unique(state.warehousePlans.map(row => row.warehouse)).sort();
      const products = unique(state.skuSummaries.map(row => row.product)).sort();
      fillSelect(els.warehouseFilter, warehouses, 'All warehouses');
      fillSelect(els.productFilter, products, 'All products');
    }

    function filterConfidenceMatch(value, filterValue) {
      return filterValue === 'all' || (value || 'Unknown') === filterValue;
    }

    function applyFilters() {
      const warehouse = els.warehouseFilter.value;
      const product = els.productFilter.value;
      const plan = els.planFilter.value;
      const confidence = els.confidenceFilter.value;

      state.filteredWarehousePlans = state.warehousePlans.filter(item => {
        const warehouseOk = warehouse === 'all' || item.warehouse === warehouse;
        const planOk = plan === 'all' || item.action === plan;
        const confidenceOk = filterConfidenceMatch(item.confidence, confidence);
        return warehouseOk && planOk && confidenceOk;
      });

      state.filteredSkuSummaries = state.skuSummaries.filter(item => {
        const warehouseOk = warehouse === 'all' || item.warehouse === warehouse;
        const productOk = product === 'all' || item.product === product;
        const confidenceOk = filterConfidenceMatch(item.confidence, confidence);
        return warehouseOk && productOk && confidenceOk;
      });

      renderEverything();
    }

    function actionLabel(action) {
      if (action === 'dispatch_now') return 'Dispatch now';
      if (action === 'dispatch_soon') return 'Dispatch soon';
      if (action === 'hold') return 'Hold below minimum';
      return 'No action';
    }

    function actionBadge(action) {
      if (action === 'dispatch_now') return '<span class="status-badge status-critical">Dispatch now</span>';
      if (action === 'dispatch_soon') return '<span class="status-badge status-warning">Dispatch soon</span>';
      if (action === 'hold') return '<span class="status-badge status-hold">Hold &lt; minimum</span>';
      return '<span class="status-badge status-healthy">No action</span>';
    }

    function renderKpis() {
      const warehouseRows = state.filteredWarehousePlans;
      const skuRows = state.filteredSkuSummaries;

      const available = warehouseRows.reduce((sum, row) => sum + row.totalAvailable, 0);
      const inTransit = warehouseRows.reduce((sum, row) => sum + row.totalTransit, 0);
      const readyCount = warehouseRows.filter(row => row.readyDispatch > 0).length;
      const holdCount = warehouseRows.filter(row => row.action === 'hold').length;
      const readyQty = warehouseRows.reduce((sum, row) => sum + row.readyDispatch, 0);
      const rawQty = warehouseRows.reduce((sum, row) => sum + row.rawNeedTotal, 0);

      const cards = [
        { label:'Current available stock', value:compactNumber(available), sub:'Latest available across filtered warehouses', bg:'bg-blue' },
        { label:'Current in transit', value:compactNumber(inTransit), sub:'Not yet available to sell', bg:'bg-peach' },
        { label:'Warehouses ready', value:compactNumber(readyCount), sub:'These have crossed the minimum basket', bg:'bg-lav' },
        { label:'Warehouses on hold', value:compactNumber(holdCount), sub:'Need exists, but still below minimum', bg:'bg-pink' },
        { label:'Ready dispatch qty', value:compactNumber(readyQty), sub:'What you should actually notify/send', bg:'bg-yellow' },
        { label:'Raw need qty', value:compactNumber(rawQty), sub:'Math before the warehouse minimum rule', bg:'bg-mint' }
      ];

      els.kpiGrid.innerHTML = cards.map(card => `
        <div class="panel kpi ${card.bg}">
          <div class="kpi-label">${card.label}</div>
          <div class="kpi-value">${card.value}</div>
          <div class="kpi-sub">${card.sub}</div>
        </div>
      `).join('');
    }

    function dispatchCardHtml(item, hold = false) {
      const driverHtml = item.topDrivers.length
        ? item.topDrivers.map(driver => `<span class="driver">${escapeHtml(driver.product)} · ${compactNumber(driver.rawNeed)}</span>`).join('')
        : '<span class="driver">No active driver</span>';

      return `
        <div class="dispatch-card ${hold ? 'hold-card' : ''}">
          <div class="dispatch-top">
            <div>
              <div class="dispatch-title">${escapeHtml(item.warehouse)}</div>
              <div class="dispatch-sub">${escapeHtml(item.city)} • ${escapeHtml(item.fcCode)} • ${formatDate(item.latestDate)}</div>
            </div>
            ${actionBadge(item.action)}
          </div>
          <div class="stat-line">
            <div class="mini-stat">
              <div class="mini-stat-label">Available</div>
              <div class="mini-stat-value">${compactNumber(item.totalAvailable)}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">In transit</div>
              <div class="mini-stat-value">${compactNumber(item.totalTransit)}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">Raw need</div>
              <div class="mini-stat-value">${compactNumber(item.rawNeedTotal)}</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-label">${hold ? 'Need more to hit minimum' : 'Ready dispatch'}</div>
              <div class="mini-stat-value">${hold ? compactNumber(item.gapToMinimum) : compactNumber(item.readyDispatch)}</div>
            </div>
          </div>
          <div class="drivers">${driverHtml}</div>
        </div>
      `;
    }

    function renderReadyAndHoldLists() {
      const ready = state.filteredWarehousePlans.filter(item => item.readyDispatch > 0).slice(0, 10);
      const hold = state.filteredWarehousePlans.filter(item => item.action === 'hold').slice(0, 10);

      els.readyBadge.textContent = `${compactNumber(ready.length)} ready`;
      els.holdBadge.textContent = `${compactNumber(hold.length)} on hold`;

      els.readyList.innerHTML = ready.length
        ? ready.map(item => dispatchCardHtml(item, false)).join('')
        : '<div class="empty">No warehouse has crossed the minimum dispatch basket in the current view.</div>';

      els.holdList.innerHTML = hold.length
        ? hold.map(item => dispatchCardHtml(item, true)).join('')
        : '<div class="empty">No hold buckets in the current view.</div>';
    }

    function renderWarehouseTable() {
      const rows = state.filteredWarehousePlans;
      if (!rows.length) {
        els.warehouseTableBody.innerHTML = '<tr><td colspan="13"><div class="empty">No warehouse rows match current filters.</div></td></tr>';
        return;
      }

      els.warehouseTableBody.innerHTML = rows.map(item => `
        <tr>
          <td><strong>${escapeHtml(item.warehouse)}</strong></td>
          <td>${escapeHtml(item.city)}<br><span class="muted">${escapeHtml(item.fcCode)}</span></td>
          <td>${formatDate(item.latestDate)}</td>
          <td>${compactNumber(item.totalAvailable)}</td>
          <td>${compactNumber(item.totalTransit)}</td>
          <td>${formatDecimal(item.totalAvgDaily, 2)}</td>
          <td>${compactNumber(item.rawNeedTotal)}</td>
          <td>${compactNumber(item.readyDispatch)}</td>
          <td>${item.gapToMinimum > 0 ? compactNumber(item.gapToMinimum) : '—'}</td>
          <td>${severityBadge(item.severity)}</td>
          <td>${actionBadge(item.action)}</td>
          <td>${item.topDrivers.length ? item.topDrivers.map(driver => `${escapeHtml(driver.product)} (${compactNumber(driver.rawNeed)})`).join(', ') : '—'}</td>
          <td>${confidenceBadge(item.confidence)}</td>
        </tr>
      `).join('');
    }

    function renderSkuTable() {
      const rows = state.filteredSkuSummaries
        .slice()
        .sort((a, b) => {
          const order = { critical: 0, warning: 1, healthy: 2 };
          const first = order[a.severity] - order[b.severity];
          if (first !== 0) return first;
          return b.rawNeed - a.rawNeed;
        });

      if (!rows.length) {
        els.skuTableBody.innerHTML = '<tr><td colspan="13"><div class="empty">No SKU rows match current filters.</div></td></tr>';
        return;
      }

      els.skuTableBody.innerHTML = rows.map(item => `
        <tr>
          <td>${escapeHtml(item.warehouse)}</td>
          <td><strong>${escapeHtml(item.product)}</strong></td>
          <td>${formatDate(item.latestDate)}</td>
          <td>${compactNumber(item.availableStock)}</td>
          <td>${compactNumber(item.inTransit)}</td>
          <td>${formatDecimal(item.avgSalesPerPeriod, 1)}</td>
          <td>${formatDecimal(item.avgDailySales, 2)}</td>
          <td>${Number.isFinite(item.daysCover) ? formatDecimal(item.daysCover, 0) + ' days' : 'No demand signal'}</td>
          <td>${compactNumber(item.rawNeed)}</td>
          <td>${compactNumber(item.warehouseRawNeed || 0)}</td>
          <td>${compactNumber(item.warehouseReadyDispatch || 0)}</td>
          <td>${severityBadge(item.severity)}</td>
          <td>${confidenceBadge(item.confidence)}</td>
        </tr>
      `).join('');
    }

    function destroyChart(name) {
      if (state.charts[name]) {
        state.charts[name].destroy();
        state.charts[name] = null;
      }
    }

    function commonChartOptions() {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#51607d', boxWidth: 16, usePointStyle: true, pointStyle: 'rectRounded' }
          },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#23304d',
            bodyColor: '#51607d',
            borderColor: '#e8eaf4',
            borderWidth: 1,
            padding: 12
          }
        },
        scales: {
          x: {
            ticks: { color: '#71809d' },
            grid: { color: 'rgba(110,120,146,0.1)' }
          },
          y: {
            ticks: { color: '#71809d' },
            grid: { color: 'rgba(110,120,146,0.12)' }
          }
        }
      };
    }

    function renderSalesTrendChart() {
      destroyChart('salesTrend');
      const map = new Map();
      state.filteredSkuSummaries.forEach(summary => {
        summary.allRows.forEach(row => {
          if (!row.date) return;
          const key = row.date.toISOString().slice(0, 10);
          if (!map.has(key)) map.set(key, 0);
          map.set(key, map.get(key) + row.soldQty);
        });
      });
      const labels = [...map.keys()].sort();
      const values = labels.map(label => map.get(label));

      state.charts.salesTrend = new Chart(document.getElementById('salesTrendChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Sold qty',
            data: values,
            borderColor: '#8b75ff',
            backgroundColor: 'rgba(139,117,255,0.14)',
            fill: true,
            tension: 0.28,
            pointRadius: 3,
            pointHoverRadius: 5
          }]
        },
        options: commonChartOptions()
      });
    }

    function renderWarehouseStockChart() {
      destroyChart('warehouseStock');
      const labels = state.filteredWarehousePlans.map(item => item.warehouse);
      const available = state.filteredWarehousePlans.map(item => item.totalAvailable);
      const transit = state.filteredWarehousePlans.map(item => item.totalTransit);

      state.charts.warehouseStock = new Chart(document.getElementById('warehouseStockChart'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Available', data: available, backgroundColor: 'rgba(95,157,255,0.72)', borderRadius: 12, stack: 'stock' },
            { label: 'In transit', data: transit, backgroundColor: 'rgba(255,159,74,0.62)', borderRadius: 12, stack: 'stock' }
          ]
        },
        options: {
          ...commonChartOptions(),
          scales: {
            x: { ticks: { color: '#71809d' }, stacked: true, grid: { color: 'rgba(110,120,146,0.1)' } },
            y: { ticks: { color: '#71809d' }, stacked: true, grid: { color: 'rgba(110,120,146,0.12)' } }
          }
        }
      });
    }

    function renderDispatchByWarehouseChart() {
      destroyChart('dispatchByWarehouse');
      const labels = state.filteredWarehousePlans.map(item => item.warehouse);
      const raw = state.filteredWarehousePlans.map(item => item.rawNeedTotal);
      const ready = state.filteredWarehousePlans.map(item => item.readyDispatch);

      state.charts.dispatchByWarehouse = new Chart(document.getElementById('dispatchByWarehouseChart'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Raw need', data: raw, backgroundColor: 'rgba(240,98,146,0.55)', borderRadius: 12 },
            { label: 'Ready dispatch', data: ready, backgroundColor: 'rgba(45,185,129,0.72)', borderRadius: 12 }
          ]
        },
        options: commonChartOptions()
      });
    }

    function renderNeedByProductChart() {
      destroyChart('needByProduct');
      const map = new Map();
      state.filteredSkuSummaries.forEach(item => {
        if (!map.has(item.product)) map.set(item.product, 0);
        map.set(item.product, map.get(item.product) + item.rawNeed);
      });
      const labels = [...map.keys()];
      const values = labels.map(label => map.get(label));

      state.charts.needByProduct = new Chart(document.getElementById('needByProductChart'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Raw need',
            data: values,
            backgroundColor: [
              'rgba(139,117,255,0.72)',
              'rgba(95,157,255,0.72)',
              'rgba(45,185,129,0.72)',
              'rgba(255,159,74,0.72)',
              'rgba(240,98,146,0.72)',
              'rgba(198,165,0,0.72)'
            ],
            borderRadius: 12
          }]
        },
        options: commonChartOptions()
      });
    }

    function renderCharts() {
      renderSalesTrendChart();
      renderWarehouseStockChart();
      renderDispatchByWarehouseChart();
      renderNeedByProductChart();
    }

    function renderEverything() {
      renderKpis();
      renderReadyAndHoldLists();
      renderWarehouseTable();
      renderSkuTable();
      renderCharts();

      els.ruleSummary.textContent = `Min basket: ${compactNumber(parseNumber(els.minDispatchQty.value) || 60)} units`;
      els.statusChip.textContent = `${compactNumber(state.filteredWarehousePlans.length)} warehouses • ${compactNumber(state.filteredSkuSummaries.length)} SKU rows`;
    }

    function exportWorkbook() {
      if (state.updatedMasterRows.length) {
        const workbook = exportRowsToWorkbook(state.updatedMasterRows, state.mergeAuditRows || []);
        XLSX.writeFile(workbook, 'warehouse_master_updated.xlsx');
        return;
      }
      if (!state.warehousePlans.length) {
        alert('Build the planner first.');
        return;
      }

      const warehouseRows = state.filteredWarehousePlans.map(item => ({
        Warehouse: item.warehouse,
        City: item.city,
        FC_Code: item.fcCode,
        Latest_Period: item.latestDate ? item.latestDate.toISOString().slice(0, 10) : '',
        Available_Stock: item.totalAvailable,
        In_Transit: item.totalTransit,
        Avg_Daily_Sales: Number(item.totalAvgDaily.toFixed(4)),
        Raw_Need: item.rawNeedTotal,
        Ready_Dispatch: item.readyDispatch,
        Gap_To_Minimum: item.gapToMinimum,
        Worst_Severity: item.severity,
        Action: actionLabel(item.action),
        Confidence: item.confidence,
        Top_SKU_Drivers: item.topDrivers.map(driver => `${driver.product} (${driver.rawNeed})`).join(', ')
      }));

      const skuRows = state.filteredSkuSummaries.map(item => ({
        Warehouse: item.warehouse,
        Product: item.product,
        Latest_Period: item.latestDate ? item.latestDate.toISOString().slice(0, 10) : '',
        Available_Stock: item.availableStock,
        In_Transit: item.inTransit,
        Avg_Sales_Per_Period: Number(item.avgSalesPerPeriod.toFixed(2)),
        Avg_Daily_Sales: Number(item.avgDailySales.toFixed(4)),
        Days_Of_Cover: Number.isFinite(item.daysCover) ? Number(item.daysCover.toFixed(2)) : '',
        Raw_Need: item.rawNeed,
        Warehouse_Raw_Total: item.warehouseRawNeed || 0,
        Warehouse_Ready_Dispatch: item.warehouseReadyDispatch || 0,
        Severity: item.severity,
        Confidence: item.confidence
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(warehouseRows), 'Warehouse_Plan');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(skuRows), 'SKU_Detail');
      XLSX.writeFile(wb, 'bubbleme_dispatch_planner_export.xlsx');
    }

    function downloadTemplate() {
      const rows = [
        {
          Month: '2026-04-01',
          Warehouse: 'Bangalore (BLR7)',
          Product: 'Spoil Yourself',
          Sent_Qty: 100,
          Sold_Qty: 88,
          Closing_Stock: 18,
          In_Transit: 0,
          Lead_Time_Days: 15,
          FC_Code: 'BLR7',
          City: 'Bangalore',
          Account_Source: 'New',
          Data_Confidence: 'High',
          Notes: 'Sample'
        },
        {
          Month: '2026-04-01',
          Warehouse: 'Gurgaon (DEL4)',
          Product: 'Minute Mend Balm',
          Sent_Qty: 20,
          Sold_Qty: 18,
          Closing_Stock: 8,
          In_Transit: 20,
          Lead_Time_Days: 15,
          FC_Code: 'DEL4',
          City: 'Gurgaon',
          Account_Source: 'New',
          Data_Confidence: 'Medium',
          Notes: 'Sample'
        }
      ];
      const ws = XLSX.utils.json_to_sheet(rows);
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'warehouse_planner_template.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    }

    function buildPlanner() {
      mappingConfig.forEach(config => {
        const select = document.getElementById(`map-${config.key}`);
        state.mappings[config.key] = select ? select.value : '';
      });
      if (!validateMappings()) return;
      buildSummaries();
      populateFilters();
      applyFilters();
    }

    els.fileInput.addEventListener('change', (event) => {
      const files = Array.from(event.target.files || []).filter(Boolean);
      if (!files.length) return;
      readWorkbookFromFile(files);
    });
    els.sheetSelect.addEventListener('change', readSelectedSheet);
    els.loadSampleBtn.addEventListener('click', loadSampleData);
    els.downloadTemplateBtn.addEventListener('click', downloadTemplate);
    els.buildBtn.addEventListener('click', buildPlanner);
    els.exportBtn.addEventListener('click', exportWorkbook);

    [els.warehouseFilter, els.productFilter, els.planFilter, els.confidenceFilter].forEach(el => {
      el.addEventListener('change', applyFilters);
    });

    createMappingUI([]);
    setupThemeControls();
    renderDataHealth();
