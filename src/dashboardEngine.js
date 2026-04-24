function num(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(...parts) {
  return parts.join('||');
}

function latestMonth(rows) {
  return [...new Set(rows.map((r) => r.Month).filter(Boolean))].sort().at(-1) || '';
}

export function buildDashboard(rows, settings, filters) {
  const products = [...new Set(rows.map((r) => r.Product).filter(Boolean))].sort();
  const warehouses = [...new Set(rows.map((r) => r.Warehouse).filter(Boolean))].sort();
  const latest = latestMonth(rows);
  const grouped = new Map();

  for (const row of rows) {
    const id = key(row.Warehouse, row.Product);
    if (!grouped.has(id)) grouped.set(id, { warehouse: row.Warehouse, product: row.Product, rows: [] });
    grouped.get(id).rows.push(row);
  }

  let summary = [...grouped.values()].map((group) => {
    const sorted = group.rows.slice().sort((a, b) => String(a.Month).localeCompare(String(b.Month)));
    const recent = sorted.slice(-3);
    const latestRow = sorted.find((r) => r.Month === latest) || sorted.at(-1) || {};
    const totalSold = recent.reduce((sum, r) => sum + num(r.Sold_Qty), 0);
    const days = Math.max(1, recent.length * 30);
    const avgDailySales = totalSold / days;
    const closingStock = num(latestRow.Closing_Stock);
    const inTransit = num(latestRow.In_Transit);
    const coverQty = closingStock + inTransit;
    const daysCover = avgDailySales > 0 ? coverQty / avgDailySales : 9999;
    const requiredQty = Math.max(0, Math.ceil((settings.bufferDays + num(latestRow.Lead_Time_Days || settings.leadTimeDays)) * avgDailySales - coverQty));
    const minimum = num(settings.minimumShipment) || 0;
    const suggestedSend = requiredQty > 0 ? Math.max(minimum, Math.ceil(requiredQty / minimum) * minimum) : 0;
    const status = daysCover <= settings.leadTimeDays ? 'Critical' : daysCover <= settings.bufferDays ? 'Warning' : 'Healthy';
    return {
      warehouse: group.warehouse,
      product: group.product,
      avgDailySales,
      closingStock,
      inTransit,
      daysCover,
      daysCoverLabel: daysCover > 9000 ? 'No sales' : Math.round(daysCover),
      suggestedSend,
      status
    };
  });

  if (filters.warehouse !== 'All') summary = summary.filter((r) => r.warehouse === filters.warehouse);
  if (filters.product !== 'All') summary = summary.filter((r) => r.product === filters.product);
  if (filters.urgency !== 'All') summary = summary.filter((r) => r.status === filters.urgency);
  summary.sort((a, b) => b.suggestedSend - a.suggestedSend || a.daysCover - b.daysCover);

  const filteredPairs = new Set(summary.map((r) => key(r.warehouse, r.product)));
  const filteredRows = rows.filter((r) => filteredPairs.has(key(r.Warehouse, r.Product)));

  const salesByMonth = new Map();
  const stockByWh = new Map();
  for (const row of filteredRows) {
    salesByMonth.set(row.Month, (salesByMonth.get(row.Month) || 0) + num(row.Sold_Qty));
    if (row.Month === latest) stockByWh.set(row.Warehouse, (stockByWh.get(row.Warehouse) || 0) + num(row.Closing_Stock) + num(row.In_Transit));
  }

  const kpis = [
    { label: 'Warehouses', value: String(new Set(summary.map((r) => r.warehouse)).size), note: 'active in dashboard' },
    { label: 'Products', value: String(new Set(summary.map((r) => r.product)).size), note: 'mapped SKUs' },
    { label: 'Critical rows', value: String(summary.filter((r) => r.status === 'Critical').length), note: 'need attention' },
    { label: 'Suggested send', value: String(summary.reduce((sum, r) => sum + r.suggestedSend, 0)), note: 'total units' }
  ];

  return {
    summary,
    kpis,
    products,
    warehouses,
    salesTrend: [...salesByMonth.entries()].sort().map(([month, sold]) => ({ month, sold })),
    stockByWarehouse: [...stockByWh.entries()].sort((a, b) => b[1] - a[1]).map(([warehouse, stock]) => ({ warehouse, stock }))
  };
}
