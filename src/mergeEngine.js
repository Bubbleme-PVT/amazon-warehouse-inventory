import * as XLSX from 'xlsx';

export const TARGET_HEADERS = ['Month', 'Warehouse', 'Product', 'Sent_Qty', 'Sold_Qty', 'Closing_Stock', 'In_Transit', 'Lead_Time_Days'];

const PRODUCT_RULES = [
  { name: 'Spoil Yourself', patterns: ['spoil', 'bs-spoil'] },
  { name: 'Epsom Salt', patterns: ['epsom'] },
  { name: 'Minute Mend Balm', patterns: ['mmend', 'minute mend', 'blm-mmend'] },
  { name: 'Reset Kit', patterns: ['reset'] },
  { name: 'Soak Potli', patterns: ['potli'] },
  { name: 'Yellow Ritual', patterns: ['yrtl', 'yellow ritual', 'yellow'] }
];

const DEFAULT_PRODUCTS = PRODUCT_RULES.map((p) => p.name);
const DEFAULT_ACTIVE_WAREHOUSES = ['LKO1', 'DEX8', 'DEX3', 'PNQ2', 'DED1', 'AMD2', 'CCX2', 'CCX1', 'NAX1', 'PNQ3', 'BOM7', 'BOM5'];

function cleanHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function normalizeKey(value) {
  return cleanHeader(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function excelSerialToDate(serial) {
  return new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000);
}

function toMonthStart(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), 1));
  if (typeof value === 'number' || /^\d{5}$/.test(String(value || '').trim())) return excelSerialToDate(Number(value));
  const raw = String(value || '').trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return new Date(Date.UTC(direct.getFullYear(), direct.getMonth(), 1));
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return new Date(Date.UTC(Number(slash[3]), Number(slash[1]) - 1, 1));
  const amazon = raw.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (amazon) {
    const parsed = new Date(`${amazon[1]} ${amazon[2]} ${amazon[3]}`);
    if (!Number.isNaN(parsed.getTime())) return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), 1));
  }
  return null;
}

function formatMonth(date) {
  if (!date) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function addMonths(date, offset) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function productNameFromText(...parts) {
  const text = parts.join(' ').toLowerCase();
  const found = PRODUCT_RULES.find((rule) => rule.patterns.some((pattern) => text.includes(pattern)));
  return found ? found.name : cleanHeader(parts.find(Boolean)) || 'Unknown Product';
}

function getValue(row, names) {
  const keys = Object.keys(row || {});
  for (const name of names) {
    const wanted = normalizeKey(name);
    const actual = keys.find((key) => normalizeKey(key) === wanted);
    if (actual) return row[actual];
  }
  return '';
}

function normalizeRowHeaders(row) {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    out[cleanHeader(key)] = value;
  });
  return out;
}

function classifyHeaders(headers) {
  const keys = new Set(headers.map(normalizeKey));
  const has = (...items) => items.every((item) => keys.has(normalizeKey(item)));
  if (TARGET_HEADERS.every((h) => keys.has(normalizeKey(h)))) return 'dashboard';
  if (has('sku', 'fnsku', 'asin', 'available') && (keys.has('units-shipped-t30') || keys.has('inbound-quantity'))) return 'fbaInventory';
  if (has('Date', 'FNSKU', 'MSKU', 'Event Type', 'Quantity', 'Fulfillment Center')) return 'inventoryLedger';
  if (has('Shipment name', 'Shipment ID', 'Ship to', 'Units expected', 'Units located', 'Status')) return 'shipmentQueue';
  return 'generic';
}

async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
}

function sheetRows(workbook) {
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).map(normalizeRowHeaders);
    if (!rows.length) return [];
    return [{ name, rows, headers: Object.keys(rows[0] || {}) }];
  });
}

export async function buildMergedDashboardRows(files, settings = {}) {
  const loaded = [];
  for (const file of files) {
    const workbook = await readWorkbook(file);
    for (const sheet of sheetRows(workbook)) {
      loaded.push({ fileName: file.name, ...sheet, type: classifyHeaders(sheet.headers) });
    }
  }
  if (!loaded.length) throw new Error('No readable rows were found in the uploaded files.');

  const dashboardSheets = loaded.filter((item) => item.type === 'dashboard');
  if (dashboardSheets.length) {
    const rows = dashboardSheets.flatMap((sheet) => sheet.rows).map((row) => toTargetRow(row, settings.leadTimeDays || 15));
    return buildResult('Already converted dashboard merge', rows, loaded, []);
  }

  const amazonSheets = loaded.filter((item) => ['fbaInventory', 'inventoryLedger', 'shipmentQueue'].includes(item.type));
  if (amazonSheets.length) {
    const rows = buildAmazonDashboardRows(amazonSheets, settings);
    const warnings = [];
    if (amazonSheets.some((s) => s.type === 'shipmentQueue')) warnings.push('Shipment queue CSV does not include product-level SKU split, so product-level inbound is taken from the FBA inventory report when available.');
    return buildResult('Amazon smart merge', rows, loaded, warnings);
  }

  const rows = loaded.flatMap((sheet) => sheet.rows).map((row) => toTargetRow(row, settings.leadTimeDays || 15));
  return buildResult('Generic table merge', rows, loaded, ['Generic merge was used. Please confirm the mapped columns are correct.']);
}

function toTargetRow(row, defaultLeadTime) {
  const month = toMonthStart(getValue(row, ['Month', 'Date', 'snapshot-date', 'Created'])) || new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1));
  return {
    Month: formatMonth(month),
    Warehouse: cleanHeader(getValue(row, ['Warehouse', 'Fulfillment Center', 'Ship to', 'fc', 'location'])) || 'Unknown Warehouse',
    Product: productNameFromText(getValue(row, ['Product', 'SKU', 'MSKU', 'sku', 'Title', 'product-name'])),
    Sent_Qty: toNumber(getValue(row, ['Sent_Qty', 'Sent Qty', 'inbound-shipped', 'Units expected', 'Quantity Sent'])),
    Sold_Qty: toNumber(getValue(row, ['Sold_Qty', 'Sold Qty', 'units-shipped-t30', 'Sold', 'Quantity Sold'])),
    Closing_Stock: toNumber(getValue(row, ['Closing_Stock', 'Closing Stock', 'available', 'Inventory Supply at FBA', 'Available Stock'])),
    In_Transit: toNumber(getValue(row, ['In_Transit', 'In Transit', 'inbound-quantity', 'Units expected', 'Inbound'])),
    Lead_Time_Days: toNumber(getValue(row, ['Lead_Time_Days', 'Lead Time Days'])) || defaultLeadTime
  };
}

function buildAmazonDashboardRows(sheets, settings) {
  const inventoryRows = sheets.filter((s) => s.type === 'fbaInventory').flatMap((s) => s.rows);
  const ledgerRows = sheets.filter((s) => s.type === 'inventoryLedger').flatMap((s) => s.rows);
  const shipmentRows = sheets.filter((s) => s.type === 'shipmentQueue').flatMap((s) => s.rows);
  const leadTime = settings.leadTimeDays || 15;

  const inventoryByProduct = new Map();
  for (const row of inventoryRows) {
    const product = productNameFromText(getValue(row, ['sku']), getValue(row, ['product-name']), getValue(row, ['asin']));
    const existing = inventoryByProduct.get(product) || emptyProductStats();
    existing.closing += toNumber(getValue(row, ['available', 'Inventory Supply at FBA']));
    existing.inbound += toNumber(getValue(row, ['inbound-quantity', 'inbound-shipped', 'inbound-working']));
    existing.ship7 += toNumber(getValue(row, ['units-shipped-t7']));
    existing.ship30 += toNumber(getValue(row, ['units-shipped-t30']));
    existing.ship60 += toNumber(getValue(row, ['units-shipped-t60']));
    existing.ship90 += toNumber(getValue(row, ['units-shipped-t90']));
    inventoryByProduct.set(product, existing);
  }

  const ledgerSold = new Map();
  const ledgerReceipts = new Map();
  const detectedWarehouses = new Set();
  let maxMonth = null;
  for (const row of ledgerRows) {
    const month = toMonthStart(getValue(row, ['Date', 'Date and Time']));
    const warehouse = cleanHeader(getValue(row, ['Fulfillment Center']));
    const product = productNameFromText(getValue(row, ['MSKU']), getValue(row, ['Title']));
    const qty = toNumber(getValue(row, ['Quantity']));
    const eventType = cleanHeader(getValue(row, ['Event Type'])).toLowerCase();
    if (!month || !warehouse || !product) continue;
    detectedWarehouses.add(warehouse);
    if (!maxMonth || month > maxMonth) maxMonth = month;
    if (qty < 0 && eventType.includes('shipment')) addToMap(ledgerSold, [formatMonth(month), warehouse, product], Math.abs(qty));
    if (qty > 0 && (eventType.includes('receipt') || eventType.includes('return'))) addToMap(ledgerReceipts, [formatMonth(month), warehouse, product], qty);
  }

  for (const row of shipmentRows) {
    const warehouse = cleanHeader(getValue(row, ['Ship to']));
    const status = cleanHeader(getValue(row, ['Status'])).toLowerCase();
    const created = toMonthStart(getValue(row, ['Created', 'Last updated']));
    if (warehouse) detectedWarehouses.add(warehouse);
    if (created && (!maxMonth || created > maxMonth)) maxMonth = created;
    if (warehouse && (status.includes('transit') || status.includes('receiving'))) {
      addToMap(ledgerReceipts, [formatMonth(created || maxMonth || new Date()), warehouse, 'Unsplit Inbound'], Math.max(0, toNumber(getValue(row, ['Units expected'])) - toNumber(getValue(row, ['Units located']))));
    }
  }

  if (!maxMonth) {
    const snap = inventoryRows.map((r) => toMonthStart(getValue(r, ['snapshot-date', 'Inventory age snapshot date']))).find(Boolean);
    maxMonth = snap || new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1));
  }

  const products = unique([...DEFAULT_PRODUCTS, ...inventoryByProduct.keys()]);
  const warehouses = detectedWarehouses.size ? unique([...DEFAULT_ACTIVE_WAREHOUSES.filter((w) => detectedWarehouses.has(w)), ...detectedWarehouses]) : DEFAULT_ACTIVE_WAREHOUSES;
  const months = [-3, -2, -1, 0].map((offset) => addMonths(maxMonth, offset));
  const latestMonth = formatMonth(months[months.length - 1]);
  const rows = [];

  for (const monthDate of months) {
    const month = formatMonth(monthDate);
    for (const warehouse of warehouses) {
      for (const product of products) {
        const inv = inventoryByProduct.get(product) || emptyProductStats();
        const soldFromLedger = getFromMap(ledgerSold, [month, warehouse, product]);
        const historical = estimateHistoricalSold(inv, month, months);
        const soldQty = soldFromLedger || (historical > 0 && month !== latestMonth ? historical : 0);
        const receiptQty = getFromMap(ledgerReceipts, [month, warehouse, product]);
        const isLatest = month === latestMonth;
        const closingStock = isLatest ? allocateProductTotal(inv.closing, warehouse, warehouses, ledgerSold, latestMonth, product) : 0;
        const inTransit = isLatest ? Math.max(receiptQty, allocateProductTotal(inv.inbound, warehouse, warehouses, ledgerSold, latestMonth, product, true)) : 0;
        const sentQty = isLatest ? Math.max(receiptQty, inTransit) : 0;
        rows.push({
          Month: month,
          Warehouse: warehouse,
          Product: product,
          Sent_Qty: Math.round(sentQty),
          Sold_Qty: Math.round(soldQty),
          Closing_Stock: Math.round(closingStock),
          In_Transit: Math.round(inTransit),
          Lead_Time_Days: leadTime
        });
      }
    }
  }

  return rows.filter((row) => row.Product !== 'Unsplit Inbound');
}

function emptyProductStats() {
  return { closing: 0, inbound: 0, ship7: 0, ship30: 0, ship60: 0, ship90: 0 };
}

function estimateHistoricalSold(inv, month, months) {
  const idx = months.map(formatMonth).indexOf(month);
  if (idx < 0) return 0;
  const buckets = [Math.max(inv.ship90 - inv.ship60, 0), Math.max(inv.ship60 - inv.ship30, 0), Math.max(inv.ship30 - inv.ship7, 0), inv.ship7];
  return buckets[idx] || 0;
}

function addToMap(map, parts, value) {
  const key = parts.join('||');
  map.set(key, (map.get(key) || 0) + value);
}

function getFromMap(map, parts) {
  return map.get(parts.join('||')) || 0;
}

function allocateProductTotal(total, warehouse, warehouses, ledgerSold, latestMonth, product, spreadOnlyActive = false) {
  if (!total) return 0;
  const active = warehouses.filter((w) => getFromMap(ledgerSold, [latestMonth, w, product]) > 0);
  const pool = spreadOnlyActive && active.length ? active : warehouses;
  if (!pool.includes(warehouse)) return 0;
  const each = total / pool.length;
  return each;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildResult(mode, rows, loaded, warnings) {
  const cleanRows = rows.map((row) => {
    const out = {};
    TARGET_HEADERS.forEach((h) => { out[h] = row[h] ?? ''; });
    return out;
  });
  const auditRows = [
    { label: 'files read', value: String(new Set(loaded.map((l) => l.fileName)).size) },
    { label: 'input sheets', value: String(loaded.length) },
    { label: 'merged dashboard rows', value: String(cleanRows.length) },
    { label: 'merge mode', value: mode }
  ];
  return { mode, rows: cleanRows, auditRows, warnings };
}

export function exportRowsToWorkbook(rows, auditRows = []) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: TARGET_HEADERS });
  XLSX.utils.book_append_sheet(wb, ws, 'Dashboard Upload');
  const audit = XLSX.utils.json_to_sheet(auditRows);
  XLSX.utils.book_append_sheet(wb, audit, 'Merge Audit');
  return wb;
}
