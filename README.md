# Warehouse Dashboard — Old UI + Fixed CSV Merge

This version keeps the original UI/UX, classes, colors, layout, sidebar, cards, charts, filters, and table flow. Only the file reading and merge/build logic has been changed so multiple Amazon CSV files can be converted into the dashboard upload schema and shown in the dashboard.

## What is fixed

- Multiple CSV/XLSX upload works in the browser.
- Amazon file types are detected automatically:
  - Shipment queue CSV
  - FBA inventory CSV
  - Inventory ledger/event CSV
  - Already-converted dashboard XLSX/CSV
- The merged data is converted into the same dashboard format:
  - `Month`
  - `Warehouse`
  - `Product`
  - `Sent_Qty`
  - `Sold_Qty`
  - `Closing_Stock`
  - `In_Transit`
  - `Lead_Time_Days`
- Dashboard charts, filters, KPIs, dispatch alerts and summary table use the converted merged data.
- No backend upload API is needed, so it can deploy on Cloudflare Pages.

## Local setup

```bash
npm install
npm run dev
```

Open the local Vite URL shown in your terminal.

## Cloudflare Pages deployment

Use these settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Node version: 20
```

## GitHub upload

```bash
git init
git add .
git commit -m "warehouse dashboard old UI cloudflare merge fix"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## Notes

The UI has intentionally not been redesigned. The old `index.html` structure and `styles.css` visual system are retained. The only app behavior change is that upload, merge, and dashboard build now run locally in the browser instead of depending on Express endpoints.
