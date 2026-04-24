# Warehouse Planner – Old UI / Full UI Refresh

This package keeps the uploaded **Warehouse Planner old.html** UI/UX style and upgrades the app for the required workflow:

- Upload **one master XLSX** plus **multiple CSV update files** together
- CSV data updates the XLSX-style planner rows
- Uses the updated merged dataset to build the dashboard / planner
- Same planner-style UI layout
- Theme options: **System (default)**, **Light**, **Dark**
- Cloudflare Pages deployable (static Vite app)

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Cloudflare Pages

- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

## Files

- `index.html` – app shell using the old planner UI layout
- `public/styles.css` – planner styling + theme support
- `src/app.js` – planner logic + theme switcher + upload flow
- `src/mergeEngine.js` – master XLSX + CSV merge/update logic
- `src/calculations.js` – extra helper logic retained from previous package
- `wrangler.toml` – Cloudflare config reference
