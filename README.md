# Warehouse Dashboard Express App

Node.js + Express version of the warehouse dashboard.

## Features

- Same frontend dashboard look and flow
- Backend parsing with `xlsx`
- Upload `.xlsx`, `.xls`, or `.csv`
- Upload multiple CSV files together and auto-merge them into a combined sheet
- Backend summary, KPI, alerts, chart data, and CSV export
- Frontend uses `fetch()` to call the backend

## Project structure

```text
/project-root
  /public
    index.html
    styles.css
    app.js
  /routes
    dashboard.js
  /controllers
    dashboardController.js
  /utils
    calculations.js
  server.js
```

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Upload behavior

- Single file upload works normally
- If you select multiple files, the backend creates a virtual sheet named:
  - `Merged Data (All uploaded files)`
- The UI automatically selects that merged sheet first
- Individual file sheets are also still available in the sheet dropdown

## API endpoints

### `POST /upload`
Upload one or more files using form-data.

Field name:
- `files`

### `POST /build`
Send:
- `uploadId` or `rawRows`
- `sheetName`
- `mappings`
- `settings`
- `filters`

### `GET /export?exportId=...`
Downloads the filtered summary as CSV.
