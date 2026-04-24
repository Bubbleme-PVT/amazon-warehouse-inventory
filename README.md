# AdSignal — Node.js + SQLite Edition

Full-stack Ad Decision Engine converted from MongoDB → SQLite (zero extra services needed).

## Architecture

```
adsignal/
├── server.js          ← Express API + cron sync + static file serving
├── ai.js              ← AI Decision Engine (ported from Python)
├── db/
│   ├── database.js    ← SQLite layer via sql.js (pure JS, no native compile)
│   └── seed.js        ← Demo data seeder
├── public/
│   └── index.html     ← Full frontend (single file, no build step)
├── adsignal.db        ← SQLite database file (auto-created on first run)
├── .env.example       ← Copy to .env and fill in
└── package.json
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Copy env file
cp .env.example .env

# 3. Start the server
npm start

# 4. Open browser
open http://localhost:3001
```

## Demo Login
- **Email:** demo@adsignal.io
- **Password:** demo1234

Demo data is automatically seeded on first run:
- 4 ad accounts (2 Google, 2 Meta)
- 11 campaigns across all accounts
- Ad sets and ads with full metrics
- 30 days of daily time-series data
- AI decisions generated from live data

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/register | Create account |
| POST | /auth/login | Login, get JWT |
| GET | /auth/me | Get current user |
| GET | /accounts | List ad accounts |
| POST | /accounts | Connect new account |
| PUT | /accounts/:id | Update account |
| DELETE | /accounts/:id | Remove account |
| GET | /campaigns | All campaigns (filterable) |
| GET | /campaigns/:id | Campaign + adsets + ads |
| PUT | /campaigns/:id/status | Pause/activate campaign |
| GET | /adsets | All ad sets |
| GET | /ads | All ads |
| GET | /ads/:id/hierarchy | Ad with full breadcrumb |
| GET | /analytics/overview | Total metrics |
| GET | /analytics/timeseries | Day-wise data |
| POST | /analytics/compare | Period comparison |
| GET | /ai/decisions | AI recommendations |
| GET | /ai/kpi/score | KPI health score 0–100 |
| POST | /sync/:accountId | Trigger manual sync |
| POST | /sync/all | Sync all accounts |

---

## Connect Real Ad Accounts

### Meta Ads API
1. Go to https://developers.facebook.com → Create App → Business type
2. Add `ads_read` + `business_management` permissions
3. Generate a long-lived access token
4. POST to `/accounts`:
```json
{
  "name": "My Meta Account",
  "platform": "meta",
  "account_id": "act_123456789",
  "access_token": "EAABs..."
}
```

### Google Ads API
Google Ads sync requires the `google-ads-api` npm package. Add your credentials:
```json
{
  "name": "My Google Account",
  "platform": "google",
  "account_id": "123-456-7890",
  "developer_token": "ABcD...",
  "client_id": "xxx.apps.googleusercontent.com",
  "refresh_token": "1//0gAB..."
}
```

---

## SQLite Notes

- The database file `adsignal.db` is created automatically in the project root
- Uses `sql.js` (pure JavaScript SQLite) — no native compilation required
- Works on any OS, any Node.js version ≥ 16
- Database is saved to disk after every write operation
- To reset: delete `adsignal.db` and restart the server

---

## Changes from MongoDB Version

| Before (MongoDB) | After (SQLite) |
|-----------------|----------------|
| `mongoose` | `sql.js` |
| `motor` (Python async) | Built into Node.js server |
| Separate Python `ai_service.py` | `ai.js` (Node.js port, same logic) |
| `mongodb://localhost:27017` | `adsignal.db` (local file) |
| Requires MongoDB server running | Zero extra services |
| ObjectId references | Integer foreign keys |
