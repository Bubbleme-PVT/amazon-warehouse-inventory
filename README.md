# Amazon Warehouse Inventory Planner

React + Node.js warehouse planner for Bubble Me Amazon inventory.

## What this version is

- **React-based UI**: `src/App.jsx` renders the full old planner UI/UX style.
- **Node.js-based local hosting**: `server.js` serves the production build with Express.
- **Cloudflare Pages deployable**: Cloudflare builds the React app with Vite and serves `dist`.
- **Master XLSX + CSV update flow**: upload old master XLSX with latest CSV update files together.
- **Theme options**: System, Light, Dark. Default is System.

## Local development

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Local production Node server

```bash
npm run serve
```

This builds the React app and starts the Node/Express server.

Or separately:

```bash
npm run build
npm start
```

## Cloudflare Pages settings

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Node version: 20
```

## Important files

```text
index.html
server.js
src/App.jsx
src/main.jsx
src/app.js
src/mergeEngine.js
src/calculations.js
public/styles.css
package.json
wrangler.toml
```

## Workflow

```text
Upload old master XLSX + latest CSV update files
→ CSV files update matching XLSX-style rows
→ old unmatched rows stay
→ new rows are appended
→ dashboard builds from the updated data
→ download updated XLSX
```
