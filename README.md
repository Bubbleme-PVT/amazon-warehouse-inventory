# Warehouse Planner Dashboard — React + Node/Vite + Cloudflare

This is a deployable React dashboard that fixes the multi-CSV merge problem by converting uploaded files into one consistent dashboard upload format.

## What it does

- Upload multiple `.csv`, `.xlsx`, or `.xls` files together.
- Detects already-converted dashboard files with this schema:
  - `Month`
  - `Warehouse`
  - `Product`
  - `Sent_Qty`
  - `Sold_Qty`
  - `Closing_Stock`
  - `In_Transit`
  - `Lead_Time_Days`
- Detects Amazon FBA CSV exports:
  - FBA inventory report, for SKU, available stock, shipped units, inbound units.
  - Inventory ledger report, for warehouse-level shipments, receipts, returns and quantities.
  - Shipment queue report, for inbound/receiving shipment status and destination FC.
- Converts the data into the exact dashboard upload schema.
- Shows KPI cards, sales trend, warehouse stock, dispatch summary, filters and merged data preview.
- Lets you download the merged output as `.xlsx` or `.csv`.

## Why the old merge broke

The uploaded CSV files are not the same table. One file is a shipment queue, one is an FBA inventory report, and one is an inventory ledger. A normal merge/appending method creates a broken table because the columns are different.

This version uses a smart merge engine:

1. Reads every uploaded file.
2. Detects the file type from headers.
3. Maps SKU/MSKU/product names into clean product names.
4. Converts everything into the dashboard schema.
5. Builds the dashboard from the merged output.

## Local setup

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

## Build

```bash
npm run build
```

The production files will be generated in:

```text
dist/
```

## Cloudflare Pages deployment

### Option 1: Deploy from Cloudflare dashboard

1. Push this folder to GitHub.
2. Open Cloudflare Pages.
3. Connect the GitHub repository.
4. Use these build settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Node version: 20
```

5. Deploy.

### Option 2: Deploy with Wrangler

```bash
npm install
npm run deploy
```

## GitHub file structure

```text
warehouse-cloudflare-react-node/
  public/
    _headers
  src/
    main.jsx
    mergeEngine.js
    dashboardEngine.js
    styles.css
  .gitignore
  .nvmrc
  index.html
  package.json
  README.md
  wrangler.toml
```

## Important note about Amazon shipment CSV

Amazon shipment queue CSV does not include product-level SKU split. Because of that, product-level inbound quantities are taken from the FBA inventory report when available. The shipment queue is still used to detect FC destinations and active inbound status.
