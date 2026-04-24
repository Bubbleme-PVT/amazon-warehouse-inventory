// ============================================================
// AdSignal — SQLite Database Layer (sql.js, pure JS)
// ============================================================
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'adsignal.db');
let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  initSchema();
  return db;
}

function saveDb() {
  if (!db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ad_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, name TEXT,
      platform TEXT CHECK(platform IN ('google','meta')) NOT NULL,
      account_id TEXT, access_token TEXT, refresh_token TEXT,
      app_id TEXT, app_secret TEXT, developer_token TEXT,
      client_id TEXT, client_secret TEXT,
      currency TEXT DEFAULT 'INR', timezone TEXT DEFAULT 'Asia/Kolkata',
      status TEXT DEFAULT 'active', color TEXT DEFAULT '#4285f4',
      last_synced TEXT, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_account_id INTEGER NOT NULL, external_id TEXT,
      name TEXT, platform TEXT, objective TEXT, type TEXT,
      status TEXT DEFAULT 'active', daily_budget REAL DEFAULT 0, lifetime_budget REAL DEFAULT 0,
      spend REAL DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
      conversions REAL DEFAULT 0, revenue REAL DEFAULT 0,
      ctr REAL DEFAULT 0, cpc REAL DEFAULT 0, cpm REAL DEFAULT 0,
      cpa REAL DEFAULT 0, roas REAL DEFAULT 0, frequency REAL DEFAULT 0, reach INTEGER DEFAULT 0,
      start_date TEXT, end_date TEXT, last_updated TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(ad_account_id) REFERENCES ad_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS ad_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER, ad_account_id INTEGER NOT NULL, external_id TEXT,
      name TEXT, platform TEXT, status TEXT DEFAULT 'active', targeting TEXT, daily_budget REAL DEFAULT 0,
      spend REAL DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
      conversions REAL DEFAULT 0, revenue REAL DEFAULT 0,
      ctr REAL DEFAULT 0, cpc REAL DEFAULT 0, cpm REAL DEFAULT 0,
      cpa REAL DEFAULT 0, roas REAL DEFAULT 0, frequency REAL DEFAULT 0, reach INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY(ad_account_id) REFERENCES ad_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_set_id INTEGER, campaign_id INTEGER, ad_account_id INTEGER NOT NULL, external_id TEXT,
      name TEXT, platform TEXT, status TEXT DEFAULT 'active', format TEXT,
      creative_headline TEXT, creative_body TEXT, creative_image TEXT, creative_cta TEXT, creative_url TEXT,
      quality_ranking TEXT, engagement_ranking TEXT,
      spend REAL DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
      conversions REAL DEFAULT 0, revenue REAL DEFAULT 0,
      ctr REAL DEFAULT 0, cpc REAL DEFAULT 0, cpm REAL DEFAULT 0,
      cpa REAL DEFAULT 0, roas REAL DEFAULT 0, frequency REAL DEFAULT 0, reach INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(ad_set_id) REFERENCES ad_sets(id),
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY(ad_account_id) REFERENCES ad_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT, entity_id INTEGER, platform TEXT, date TEXT,
      spend REAL DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
      conversions REAL DEFAULT 0, revenue REAL DEFAULT 0, roas REAL DEFAULT 0, ctr REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER, campaign_name TEXT, platform TEXT,
      metric TEXT, z_score REAL, current_value REAL, mean_value REAL,
      severity TEXT, message TEXT,
      detected_at TEXT DEFAULT (datetime('now')), dismissed INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, platform TEXT NOT NULL,
      key_name TEXT NOT NULL, key_value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, platform, key_name)
    );
    CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER, platform TEXT, forecast_date TEXT,
      predicted_spend REAL, predicted_conversions REAL, predicted_roas REAL,
      confidence REAL, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  saveDb();
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) { return query(sql, params)[0] || null; }

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return { lastID: queryOne('SELECT last_insert_rowid() as id')?.id };
}

module.exports = { getDb, saveDb, query, queryOne, run };
