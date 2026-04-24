import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import './styles.css';
import { buildMergedDashboardRows, exportRowsToWorkbook, TARGET_HEADERS } from './mergeEngine.js';
import { buildDashboard } from './dashboardEngine.js';

function App() {
  const [files, setFiles] = useState([]);
  const [mergeResult, setMergeResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ warehouse: 'All', product: 'All', urgency: 'All' });
  const [settings, setSettings] = useState({ bufferDays: 21, minimumShipment: 60, leadTimeDays: 15 });

  const dashboard = useMemo(() => {
    if (!mergeResult?.rows?.length) return null;
    return buildDashboard(mergeResult.rows, settings, filters);
  }, [mergeResult, settings, filters]);

  async function handleFiles(selected) {
    const chosen = Array.from(selected || []);
    setFiles(chosen);
    setMergeResult(null);
    setError('');
    if (!chosen.length) return;
    setBusy(true);
    try {
      const result = await buildMergedDashboardRows(chosen, settings);
      setMergeResult(result);
      setFilters({ warehouse: 'All', product: 'All', urgency: 'All' });
    } catch (err) {
      setError(err?.message || 'Could not read and merge these files.');
    } finally {
      setBusy(false);
    }
  }

  function downloadMergedXlsx() {
    if (!mergeResult?.rows?.length) return;
    const wb = exportRowsToWorkbook(mergeResult.rows, mergeResult.auditRows);
    XLSX.writeFile(wb, 'dashboard_upload_merged.xlsx');
  }

  function downloadMergedCsv() {
    if (!mergeResult?.rows?.length) return;
    const ws = XLSX.utils.json_to_sheet(mergeResult.rows, { header: TARGET_HEADERS });
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dashboard_upload_merged.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const warehouses = dashboard?.warehouses || [];
  const products = dashboard?.products || [];

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brandCard card">
          <div className="logo">WM</div>
          <div>
            <h1>Warehouse Dashboard</h1>
            <p>Amazon CSV merge + stockout planning</p>
          </div>
        </div>

        <section className="card uploadCard">
          <div className="step">1</div>
          <h2>Upload CSV / XLSX files</h2>
          <p className="muted">Select your Amazon CSV files together. The app converts them into this dashboard format: Month, Warehouse, Product, Sent_Qty, Sold_Qty, Closing_Stock, In_Transit, Lead_Time_Days.</p>
          <label className="dropZone">
            <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={(e) => handleFiles(e.target.files)} />
            <strong>{files.length ? `${files.length} file(s) selected` : 'Choose files'}</strong>
            <span>Multiple CSV files are smart-merged.</span>
          </label>
          <div className="fileList">
            {files.length ? files.map((file) => <span key={file.name}>{file.name}</span>) : <span>No file chosen</span>}
          </div>
          {busy && <div className="notice">Reading files and building merged dashboard rows…</div>}
          {error && <div className="errorBox">{error}</div>}
        </section>

        <section className="card">
          <div className="step">2</div>
          <h2>Planner settings</h2>
          <label className="field">Stockout warning days
            <input type="number" value={settings.bufferDays} onChange={(e) => setSettings({ ...settings, bufferDays: Number(e.target.value || 0) })} />
          </label>
          <label className="field">Minimum shipment bucket
            <input type="number" value={settings.minimumShipment} onChange={(e) => setSettings({ ...settings, minimumShipment: Number(e.target.value || 0) })} />
          </label>
          <label className="field">Default lead time days
            <input type="number" value={settings.leadTimeDays} onChange={(e) => setSettings({ ...settings, leadTimeDays: Number(e.target.value || 0) })} />
          </label>
          <div className="buttonGrid">
            <button disabled={!mergeResult?.rows?.length} onClick={downloadMergedXlsx}>Download merged XLSX</button>
            <button disabled={!mergeResult?.rows?.length} onClick={downloadMergedCsv} className="secondaryBtn">Download merged CSV</button>
          </div>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">React + Node/Vite • Cloudflare ready</p>
            <h1>Inventory, sales & dispatch planner</h1>
          </div>
          <div className="statusPill">{mergeResult ? `${mergeResult.rows.length} dashboard rows` : 'Upload files to start'}</div>
        </header>

        {mergeResult && (
          <section className="card mergeCard">
            <div className="mergeHeader">
              <div>
                <h2>Merged file output</h2>
                <p className="muted">The app creates the exact dashboard upload schema. File format can be CSV or XLSX; the data structure stays the same.</p>
              </div>
              <span className="modeBadge">{mergeResult.mode}</span>
            </div>
            <div className="auditGrid">
              {mergeResult.auditRows.map((item) => (
                <div className="auditItem" key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            {mergeResult.warnings.length > 0 && <div className="warningBox">{mergeResult.warnings.join(' ')}</div>}
          </section>
        )}

        {dashboard ? (
          <>
            <section className="kpiGrid">
              {dashboard.kpis.map((kpi) => (
                <div className="kpi card" key={kpi.label}>
                  <span>{kpi.label}</span>
                  <strong>{kpi.value}</strong>
                  <em>{kpi.note}</em>
                </div>
              ))}
            </section>

            <section className="card controls">
              <label>Warehouse
                <select value={filters.warehouse} onChange={(e) => setFilters({ ...filters, warehouse: e.target.value })}>
                  <option>All</option>{warehouses.map((w) => <option key={w}>{w}</option>)}
                </select>
              </label>
              <label>Product
                <select value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
                  <option>All</option>{products.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
              <label>Urgency
                <select value={filters.urgency} onChange={(e) => setFilters({ ...filters, urgency: e.target.value })}>
                  <option>All</option><option>Critical</option><option>Warning</option><option>Healthy</option>
                </select>
              </label>
            </section>

            <section className="layoutTwo">
              <div className="card">
                <h2>Sales trend</h2>
                <BarChart data={dashboard.salesTrend} labelKey="month" valueKey="sold" />
              </div>
              <div className="card">
                <h2>Stock by warehouse</h2>
                <BarChart data={dashboard.stockByWarehouse} labelKey="warehouse" valueKey="stock" />
              </div>
            </section>

            <section className="card">
              <h2>Dispatch summary</h2>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr><th>Warehouse</th><th>Product</th><th>Avg daily sales</th><th>Closing stock</th><th>In transit</th><th>Days cover</th><th>Suggested send</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {dashboard.summary.map((row) => (
                      <tr key={`${row.warehouse}-${row.product}`}>
                        <td>{row.warehouse}</td><td>{row.product}</td><td>{row.avgDailySales.toFixed(2)}</td><td>{row.closingStock}</td><td>{row.inTransit}</td><td>{row.daysCoverLabel}</td><td>{row.suggestedSend}</td><td><span className={`tag ${row.status.toLowerCase()}`}>{row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <h2>Merged data preview</h2>
              <div className="tableWrap smallTable">
                <table>
                  <thead><tr>{TARGET_HEADERS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{mergeResult.rows.slice(0, 30).map((row, idx) => <tr key={idx}>{TARGET_HEADERS.map((h) => <td key={h}>{row[h]}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className="emptyState card">
            <h2>Upload your CSV files</h2>
            <p>The fixed merge supports three cases: already-converted dashboard XLSX/CSV, normal single table files, and Amazon FBA exports such as inventory, inventory ledger and shipment queue CSV files.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function BarChart({ data, labelKey, valueKey }) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return <div className="bars">{data.slice(0, 12).map((d) => <div className="barRow" key={d[labelKey]}><span>{d[labelKey]}</span><div><i style={{ width: `${Math.max(2, ((Number(d[valueKey]) || 0) / max) * 100)}%` }} /></div><b>{Math.round(Number(d[valueKey]) || 0)}</b></div>)}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
