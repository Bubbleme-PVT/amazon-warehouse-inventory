// ============================================================
// AdSignal Backend v2 — Express + SQLite + WebSocket + AI
// ============================================================
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const cors      = require('cors');
const axios     = require('axios');
const cron      = require('node-cron');
const path      = require('path');

const { getDb, query, queryOne, run } = require('./db/database');
const { seedIfEmpty }                 = require('./db/seed');
const { generateDecisions, runAnomalyDetection, runForecasting } = require('./ai');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'adsignal_secret_2024';
const PORT       = process.env.PORT || 3001;

// ─── WEBSOCKET: push live KPI updates every 30s ──────────────
const clients = new Set();
wss.on('connection', (ws, req) => {
  // auth via ?token= query param
  const url   = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');
  let userId  = null;
  try { userId = jwt.verify(token, JWT_SECRET).userId; } catch {}
  if (!userId) { ws.close(); return; }
  ws.userId = userId;
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  // immediately send current KPIs
  pushKpis(userId, ws);
});

function pushKpis(userId, targetWs) {
  try {
    const accounts = query('SELECT id FROM ad_accounts WHERE user_id = ?', [userId]);
    const accIds   = accounts.map(a => a.id);
    if (!accIds.length) return;
    const camps  = query(`SELECT * FROM campaigns WHERE ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds);
    const totals = camps.reduce((acc, c) => ({
      spend:       acc.spend       + (c.spend       || 0),
      impressions: acc.impressions + (c.impressions || 0),
      clicks:      acc.clicks      + (c.clicks      || 0),
      conversions: acc.conversions + (c.conversions || 0),
      revenue:     acc.revenue     + (c.revenue     || 0),
    }), { spend:0, impressions:0, clicks:0, conversions:0, revenue:0 });
    totals.roas = totals.spend ? +(totals.revenue / totals.spend).toFixed(2) : 0;
    totals.ctr  = totals.impressions ? +(totals.clicks / totals.impressions * 100).toFixed(2) : 0;
    totals.cpa  = totals.conversions ? +(totals.spend / totals.conversions).toFixed(2) : 0;
    const payload = JSON.stringify({ type: 'kpi_update', data: totals, ts: Date.now() });
    if (targetWs) {
      if (targetWs.readyState === WebSocket.OPEN) targetWs.send(payload);
    } else {
      clients.forEach(ws => {
        if (ws.userId === userId && ws.readyState === WebSocket.OPEN) ws.send(payload);
      });
    }
  } catch(e) { /* silent */ }
}

// Push to all connected users every 30s
setInterval(() => {
  const userIds = [...new Set([...clients].map(ws => ws.userId).filter(Boolean))];
  userIds.forEach(uid => pushKpis(uid, null));
}, 30000);

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────
const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ─── AUTH ─────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (queryOne('SELECT id FROM users WHERE email=?', [email]))
      return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const r      = run('INSERT INTO users (name,email,password) VALUES(?,?,?)', [name||email.split('@')[0], email, hashed]);
    const user   = queryOne('SELECT id,name,email FROM users WHERE id=?', [r.lastID]);
    res.json({ token: jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn:'7d' }), user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = queryOne('SELECT * FROM users WHERE email=?', [email]);
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(400).json({ error: 'Invalid credentials' });
    res.json({
      token: jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn:'7d' }),
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/auth/me', auth, (req, res) => {
  res.json(queryOne('SELECT id,name,email FROM users WHERE id=?', [req.userId]));
});

// ─── API KEYS (Setup Page) ────────────────────────────────────
app.get('/setup/keys', auth, (req, res) => {
  const keys = query('SELECT platform, key_name, created_at FROM api_keys WHERE user_id=?', [req.userId]);
  // Return masked values
  const masked = {};
  keys.forEach(k => {
    if (!masked[k.platform]) masked[k.platform] = {};
    masked[k.platform][k.key_name] = '••••••••';
  });
  res.json(masked);
});

app.post('/setup/keys', auth, (req, res) => {
  try {
    const { platform, keys } = req.body; // keys = { key_name: key_value }
    Object.entries(keys).forEach(([key_name, key_value]) => {
      if (!key_value) return;
      run(`INSERT INTO api_keys (user_id, platform, key_name, key_value)
           VALUES (?,?,?,?)
           ON CONFLICT(user_id, platform, key_name) DO UPDATE SET key_value=excluded.key_value`,
        [req.userId, platform, key_name, key_value]);
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function getKey(userId, platform, name) {
  const row = queryOne('SELECT key_value FROM api_keys WHERE user_id=? AND platform=? AND key_name=?',
    [userId, platform, name]);
  return row?.key_value || null;
}

// ─── AD ACCOUNTS ─────────────────────────────────────────────
app.get('/accounts', auth, (req, res) => {
  res.json(query('SELECT * FROM ad_accounts WHERE user_id=?', [req.userId]));
});

app.post('/accounts', auth, (req, res) => {
  try {
    const { name, platform, account_id, access_token, refresh_token,
            app_id, app_secret, developer_token, client_id, client_secret, color } = req.body;
    const r   = run(
      `INSERT INTO ad_accounts (user_id,name,platform,account_id,access_token,refresh_token,
         app_id,app_secret,developer_token,client_id,client_secret,color)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.userId, name, platform, account_id, access_token, refresh_token,
       app_id, app_secret, developer_token, client_id, client_secret, color||'#4285f4']
    );
    res.json(queryOne('SELECT * FROM ad_accounts WHERE id=?', [r.lastID]));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/accounts/:id', auth, (req, res) => {
  const { name, status, color } = req.body;
  run('UPDATE ad_accounts SET name=?,status=?,color=? WHERE id=? AND user_id=?',
    [name, status, color, req.params.id, req.userId]);
  res.json(queryOne('SELECT * FROM ad_accounts WHERE id=?', [req.params.id]));
});

app.delete('/accounts/:id', auth, (req, res) => {
  ['ads','ad_sets','campaigns'].forEach(t =>
    run(`DELETE FROM ${t} WHERE ad_account_id=?`, [req.params.id]));
  run('DELETE FROM ad_accounts WHERE id=? AND user_id=?', [req.params.id, req.userId]);
  res.json({ success: true });
});

// ─── CAMPAIGNS ───────────────────────────────────────────────
app.get('/campaigns', auth, (req, res) => {
  try {
    const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
    if (!accounts.length) return res.json([]);
    const accIds = accounts.map(a => a.id);
    const { status, platform, accountId } = req.query;
    let sql = `SELECT c.*, a.name as account_name, a.color as account_color, a.status as account_status
               FROM campaigns c JOIN ad_accounts a ON c.ad_account_id=a.id
               WHERE c.ad_account_id IN (${accIds.map(()=>'?').join(',')})`;
    const params = [...accIds];
    if (status && status !== 'all')   { sql += ' AND c.status=?';       params.push(status); }
    if (platform && platform !== 'all'){ sql += ' AND c.platform=?';    params.push(platform); }
    if (accountId)                     { sql += ' AND c.ad_account_id=?'; params.push(accountId); }
    sql += ' ORDER BY c.spend DESC';
    res.json(query(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/campaigns/:id', auth, (req, res) => {
  const campaign = queryOne('SELECT * FROM campaigns WHERE id=?', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  res.json({
    campaign,
    adsets: query('SELECT * FROM ad_sets WHERE campaign_id=?', [req.params.id]),
    ads:    query('SELECT * FROM ads WHERE campaign_id=?', [req.params.id])
  });
});

app.put('/campaigns/:id/status', auth, (req, res) => {
  run('UPDATE campaigns SET status=? WHERE id=?', [req.body.status, req.params.id]);
  res.json({ success: true, status: req.body.status });
});

// ─── AD SETS ─────────────────────────────────────────────────
app.get('/adsets', auth, (req, res) => {
  const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  if (!accounts.length) return res.json([]);
  const accIds = accounts.map(a => a.id);
  const { campaignId, status, platform } = req.query;
  let sql = `SELECT s.*, a.name as account_name, a.color as account_color, c.name as campaign_name
             FROM ad_sets s JOIN ad_accounts a ON s.ad_account_id=a.id
             LEFT JOIN campaigns c ON s.campaign_id=c.id
             WHERE s.ad_account_id IN (${accIds.map(()=>'?').join(',')})`;
  const params = [...accIds];
  if (campaignId)                    { sql += ' AND s.campaign_id=?'; params.push(campaignId); }
  if (status && status !== 'all')    { sql += ' AND s.status=?';      params.push(status); }
  if (platform && platform !== 'all'){ sql += ' AND s.platform=?';    params.push(platform); }
  sql += ' ORDER BY s.spend DESC';
  res.json(query(sql, params));
});

// ─── ADS ─────────────────────────────────────────────────────
app.get('/ads', auth, (req, res) => {
  const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  if (!accounts.length) return res.json([]);
  const accIds = accounts.map(a => a.id);
  const { adSetId, campaignId, status, platform } = req.query;
  let sql = `SELECT d.*, a.name as account_name, a.color as account_color,
                    c.name as campaign_name, s.name as adset_name
             FROM ads d JOIN ad_accounts a ON d.ad_account_id=a.id
             LEFT JOIN campaigns c ON d.campaign_id=c.id
             LEFT JOIN ad_sets s ON d.ad_set_id=s.id
             WHERE d.ad_account_id IN (${accIds.map(()=>'?').join(',')})`;
  const params = [...accIds];
  if (adSetId)                       { sql += ' AND d.ad_set_id=?';   params.push(adSetId); }
  if (campaignId)                    { sql += ' AND d.campaign_id=?'; params.push(campaignId); }
  if (status && status !== 'all')    { sql += ' AND d.status=?';      params.push(status); }
  if (platform && platform !== 'all'){ sql += ' AND d.platform=?';    params.push(platform); }
  sql += ' ORDER BY d.spend DESC';
  res.json(query(sql, params));
});

app.get('/ads/:id/hierarchy', auth, (req, res) => {
  const ad = queryOne(`
    SELECT d.*, a.name as account_name, a.color as account_color, a.status as account_status,
           c.name as campaign_name, c.objective as campaign_objective, c.status as campaign_status,
           s.name as adset_name, s.targeting as adset_targeting, s.status as adset_status
    FROM ads d
    JOIN ad_accounts a ON d.ad_account_id=a.id
    LEFT JOIN campaigns c ON d.campaign_id=c.id
    LEFT JOIN ad_sets s ON d.ad_set_id=s.id
    WHERE d.id=?`, [req.params.id]);
  if (!ad) return res.status(404).json({ error: 'Not found' });
  res.json({ ad, hierarchy: {
    account:  { id: ad.ad_account_id, name: ad.account_name, color: ad.account_color },
    campaign: { id: ad.campaign_id,   name: ad.campaign_name, objective: ad.campaign_objective },
    adset:    { id: ad.ad_set_id,     name: ad.adset_name,   targeting: ad.adset_targeting },
    ad:       { id: ad.id,            name: ad.name,         format: ad.format }
  }});
});

// ─── ANALYTICS ───────────────────────────────────────────────
app.get('/analytics/overview', auth, (req, res) => {
  const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  if (!accounts.length) return res.json({ totals:{}, accounts:0, campaigns:0 });
  const accIds = accounts.map(a => a.id);
  const camps  = query(`SELECT * FROM campaigns WHERE ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds);
  const totals = camps.reduce((acc,c) => ({
    spend:       acc.spend       + (c.spend||0),
    impressions: acc.impressions + (c.impressions||0),
    clicks:      acc.clicks      + (c.clicks||0),
    conversions: acc.conversions + (c.conversions||0),
    revenue:     acc.revenue     + (c.revenue||0),
  }), { spend:0, impressions:0, clicks:0, conversions:0, revenue:0 });
  totals.ctr  = totals.impressions ? +(totals.clicks/totals.impressions*100).toFixed(2) : 0;
  totals.roas = totals.spend      ? +(totals.revenue/totals.spend).toFixed(2)          : 0;
  totals.cpa  = totals.conversions? +(totals.spend/totals.conversions).toFixed(2)      : 0;
  res.json({ totals, accounts: accounts.length, campaigns: camps.length });
});

app.get('/analytics/timeseries', auth, (req, res) => {
  const { days=30, platform } = req.query;
  const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  if (!accounts.length) return res.json([]);
  const accIds = accounts.map(a => a.id);
  const campIds = query(`SELECT id FROM campaigns WHERE ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds).map(c=>c.id);
  if (!campIds.length) return res.json([]);
  let sql = `SELECT * FROM daily_metrics WHERE entity_id IN (${campIds.map(()=>'?').join(',')})`;
  const params = [...campIds];
  if (platform && platform !== 'all') { sql += ' AND platform=?'; params.push(platform); }
  sql += ` AND date >= date('now', '-${parseInt(days)} days') ORDER BY date ASC`;
  const rows = query(sql, params);
  const map  = {};
  rows.forEach(r => {
    if (!map[r.date]) map[r.date] = { date:r.date, spend:0, impressions:0, clicks:0, conversions:0, revenue:0, google:0, meta:0 };
    map[r.date].spend       += r.spend||0;
    map[r.date].impressions += r.impressions||0;
    map[r.date].clicks      += r.clicks||0;
    map[r.date].conversions += r.conversions||0;
    map[r.date].revenue     += r.revenue||0;
    if (r.platform==='google') map[r.date].google += r.spend||0;
    else                       map[r.date].meta   += r.spend||0;
  });
  res.json(Object.values(map));
});

app.post('/analytics/compare', auth, (req, res) => {
  const { entityIds, entityType } = req.body;
  const table = entityType==='campaign' ? 'campaigns' : entityType==='adset' ? 'ad_sets' : 'ads';
  const rows  = query(`SELECT * FROM ${table} WHERE id IN (${entityIds.map(()=>'?').join(',')})`, entityIds);
  res.json(rows.map(e => ({
    id: e.id, name: e.name,
    period1: { spend:e.spend, roas:e.roas, ctr:e.ctr, cpa:e.cpa, conversions:e.conversions },
    period2: { spend:e.spend*0.85, roas:e.roas*0.88, ctr:e.ctr*0.91, cpa:e.cpa*1.12, conversions:e.conversions*0.79 }
  })));
});

// ─── AI / DECISIONS ──────────────────────────────────────────
app.get('/ai/decisions', auth, (req, res) => {
  const accounts    = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  const accIds      = accounts.map(a => a.id);
  const campaigns   = accIds.length
    ? query(`SELECT * FROM campaigns WHERE ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds) : [];
  const ads         = accIds.length
    ? query(`SELECT d.*, c.name as campaign_name FROM ads d LEFT JOIN campaigns c ON d.campaign_id=c.id WHERE d.ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds) : [];
  const dailyMetrics = campaigns.length
    ? query(`SELECT * FROM daily_metrics WHERE entity_id IN (${campaigns.map(()=>'?').join(',')}) AND date >= date('now','-30 days')`,
        campaigns.map(c=>c.id)) : [];

  const decisions = generateDecisions(campaigns, ads, dailyMetrics);
  res.json({ decisions, count: decisions.length, generatedAt: new Date().toISOString() });
});

app.get('/ai/kpi/score', auth, (req, res) => {
  const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  const accIds   = accounts.map(a => a.id);
  if (!accIds.length) return res.json({ score:0, grade:'N/A', breakdown:{} });
  const camps = query(`SELECT * FROM campaigns WHERE ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds);
  if (!camps.length) return res.json({ score:0, grade:'N/A', breakdown:{} });
  const scores = {};
  camps.forEach(c => {
    scores[c.name] = Math.min(100,(c.roas||0)/5*100)*0.4
      + Math.min(100,(c.ctr||0)/5*100)*0.2
      + Math.max(0,100-(Math.max(0,(c.frequency||0)-2)*20))*0.2
      + Math.min(100,c.conversions||0)*0.2;
  });
  const avg   = Math.round(Object.values(scores).reduce((s,v)=>s+v,0)/Object.values(scores).length);
  const grade = avg>=80?'A':avg>=65?'B':avg>=50?'C':'D';
  res.json({ score:avg, grade, breakdown:scores });
});

app.get('/ai/anomalies', auth, (req, res) => {
  const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  const accIds   = accounts.map(a => a.id);
  if (!accIds.length) return res.json([]);
  const campIds  = query(`SELECT id FROM campaigns WHERE ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds).map(c=>c.id);
  if (!campIds.length) return res.json([]);
  res.json(query(`SELECT * FROM anomalies WHERE campaign_id IN (${campIds.map(()=>'?').join(',')}) AND dismissed=0 ORDER BY detected_at DESC LIMIT 50`, campIds));
});

app.get('/ai/forecasts', auth, (req, res) => {
  const accounts = query('SELECT id FROM ad_accounts WHERE user_id=?', [req.userId]);
  const accIds   = accounts.map(a => a.id);
  if (!accIds.length) return res.json([]);
  const campIds  = query(`SELECT id FROM campaigns WHERE ad_account_id IN (${accIds.map(()=>'?').join(',')})`, accIds).map(c=>c.id);
  if (!campIds.length) return res.json([]);
  res.json(query(`SELECT * FROM forecasts WHERE campaign_id IN (${campIds.map(()=>'?').join(',')}) ORDER BY forecast_date ASC`, campIds));
});

// ─── SYNC ────────────────────────────────────────────────────
app.post('/sync/:accountId', auth, async (req, res) => {
  const acc = queryOne('SELECT * FROM ad_accounts WHERE id=? AND user_id=?', [req.params.accountId, req.userId]);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  syncAccount(acc, req.userId).catch(console.error);
  res.json({ message: 'Sync started' });
});

app.post('/sync/all', auth, async (req, res) => {
  const accounts = query('SELECT * FROM ad_accounts WHERE user_id=?', [req.userId]);
  accounts.forEach(acc => syncAccount(acc, req.userId).catch(console.error));
  res.json({ message: `Syncing ${accounts.length} accounts` });
});

async function syncAccount(account, userId) {
  console.log(`🔄 Syncing ${account.name} (${account.platform})`);
  try {
    if (account.platform === 'meta') {
      const token = account.access_token
        || (userId ? getKey(userId, 'meta', 'access_token') : null);
      if (token) await syncMeta(account, token);
      else console.log(`  ⚠️  No Meta token for ${account.name} — skipping live sync`);
    } else if (account.platform === 'google') {
      const devToken    = account.developer_token    || (userId ? getKey(userId, 'google', 'developer_token')    : null);
      const clientId    = account.client_id          || (userId ? getKey(userId, 'google', 'client_id')          : null);
      const clientSecret= account.client_secret      || (userId ? getKey(userId, 'google', 'client_secret')      : null);
      const refreshToken= account.refresh_token      || (userId ? getKey(userId, 'google', 'refresh_token')      : null);
      if (devToken && clientId && refreshToken) await syncGoogle(account, { devToken, clientId, clientSecret, refreshToken });
      else console.log(`  ⚠️  Missing Google creds for ${account.name} — skipping live sync`);
    }
    run("UPDATE ad_accounts SET last_synced=datetime('now') WHERE id=?", [account.id]);

    // Run AI engines after sync
    const camps = query('SELECT * FROM campaigns WHERE ad_account_id=?', [account.id]);
    if (camps.length) {
      const dailyM  = query(`SELECT * FROM daily_metrics WHERE entity_id IN (${camps.map(()=>'?').join(',')}) AND date>=date('now','-30 days')`, camps.map(c=>c.id));
      // Anomaly detection
      const { anomalies } = runAnomalyDetection(camps, dailyM);
      anomalies.forEach(a => {
        run(`INSERT INTO anomalies (campaign_id,campaign_name,platform,metric,z_score,current_value,mean_value,severity,message)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          [a.campaign_id, a.campaign_name, a.platform, a.metric, a.z_score, a.current_value, a.mean_value, a.severity, a.message]);
      });
      // Forecasting
      const forecasts = runForecasting(camps, dailyM);
      // Clear old forecasts and insert new
      run(`DELETE FROM forecasts WHERE campaign_id IN (${camps.map(()=>'?').join(',')})`, camps.map(c=>c.id));
      forecasts.forEach(f => {
        run(`INSERT INTO forecasts (campaign_id,platform,forecast_date,predicted_spend,predicted_conversions,predicted_roas,confidence)
             VALUES (?,?,?,?,?,?,?)`,
          [f.campaign_id, f.platform, f.forecast_date, f.predicted_spend, f.predicted_conversions, f.predicted_roas, f.confidence]);
      });
    }
    console.log(`✅ Synced ${account.name}`);
  } catch(e) {
    console.error(`❌ Sync failed for ${account.name}:`, e.message);
  }
}

// ─── META SYNC ───────────────────────────────────────────────
async function syncMeta(account, token) {
  const base  = 'https://graph.facebook.com/v19.0';
  const actId = account.account_id.startsWith('act_') ? account.account_id : `act_${account.account_id}`;

  // Fetch campaigns
  const campRes = await axios.get(`${base}/${actId}/campaigns`, {
    params: { access_token: token, fields: 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time', limit: 100 }
  });

  for (const mc of (campRes.data.data || [])) {
    // Fetch insights
    let m = {};
    try {
      const ins = (await axios.get(`${base}/${mc.id}/insights`, {
        params: {
          access_token: token,
          fields: 'spend,impressions,clicks,actions,action_values,ctr,cpc,cpm,frequency,reach',
          date_preset: 'last_30d'
        }
      })).data.data?.[0] || {};
      const conv = parseFloat((ins.actions||[]).find(a=>a.action_type==='purchase')?.value||0);
      const rev  = parseFloat((ins.action_values||[]).find(a=>a.action_type==='purchase')?.value||0);
      const sp   = parseFloat(ins.spend||0);
      m = { spend:sp, impressions:parseInt(ins.impressions||0), clicks:parseInt(ins.clicks||0),
            conversions:conv, revenue:rev, ctr:parseFloat(ins.ctr||0), cpc:parseFloat(ins.cpc||0),
            cpm:parseFloat(ins.cpm||0), frequency:parseFloat(ins.frequency||0), reach:parseInt(ins.reach||0),
            roas:sp>0?rev/sp:0, cpa:conv>0?sp/conv:0 };
    } catch {}

    const existing = queryOne('SELECT id FROM campaigns WHERE external_id=? AND ad_account_id=?', [mc.id, account.id]);
    if (existing) {
      run(`UPDATE campaigns SET name=?,status=?,daily_budget=?,spend=?,impressions=?,clicks=?,
           conversions=?,revenue=?,ctr=?,cpc=?,cpm=?,cpa=?,roas=?,frequency=?,reach=?,last_updated=datetime('now') WHERE id=?`,
        [mc.name, mc.status?.toLowerCase(), (mc.daily_budget||0)/100,
         m.spend||0, m.impressions||0, m.clicks||0, m.conversions||0, m.revenue||0,
         m.ctr||0, m.cpc||0, m.cpm||0, m.cpa||0, m.roas||0, m.frequency||0, m.reach||0, existing.id]);
    } else {
      run(`INSERT INTO campaigns (ad_account_id,external_id,name,platform,objective,status,daily_budget,
           spend,impressions,clicks,conversions,revenue,ctr,cpc,cpm,cpa,roas,frequency,reach)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [account.id, mc.id, mc.name, 'meta', mc.objective, mc.status?.toLowerCase(), (mc.daily_budget||0)/100,
         m.spend||0, m.impressions||0, m.clicks||0, m.conversions||0, m.revenue||0,
         m.ctr||0, m.cpc||0, m.cpm||0, m.cpa||0, m.roas||0, m.frequency||0, m.reach||0]);
    }

    // Fetch daily breakdown
    const campRow = queryOne('SELECT id FROM campaigns WHERE external_id=? AND ad_account_id=?', [mc.id, account.id]);
    if (campRow) {
      try {
        const dayRes = await axios.get(`${base}/${mc.id}/insights`, {
          params: { access_token: token, fields: 'spend,impressions,clicks,actions,action_values,ctr', time_increment: 1, date_preset: 'last_30d' }
        });
        for (const day of (dayRes.data.data || [])) {
          const dConv = parseFloat((day.actions||[]).find(a=>a.action_type==='purchase')?.value||0);
          const dRev  = parseFloat((day.action_values||[]).find(a=>a.action_type==='purchase')?.value||0);
          const dSp   = parseFloat(day.spend||0);
          const existing = queryOne('SELECT id FROM daily_metrics WHERE entity_id=? AND date=? AND entity_type=?', [campRow.id, day.date_start, 'campaign']);
          if (!existing) {
            run(`INSERT INTO daily_metrics (entity_type,entity_id,platform,date,spend,impressions,clicks,conversions,revenue,roas,ctr)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              ['campaign', campRow.id, 'meta', day.date_start, dSp, parseInt(day.impressions||0),
               parseInt(day.clicks||0), dConv, dRev, dSp>0?dRev/dSp:0, parseFloat(day.ctr||0)]);
          }
        }
      } catch {}
    }

    // Fetch Ad Sets
    try {
      const asRes = await axios.get(`${base}/${mc.id}/adsets`, {
        params: { access_token: token, fields: 'id,name,status,daily_budget,targeting', limit: 100 }
      });
      for (const as of (asRes.data.data || [])) {
        let asm = {};
        try {
          const asIns = (await axios.get(`${base}/${as.id}/insights`, {
            params: { access_token: token, fields: 'spend,impressions,clicks,actions,action_values,ctr,cpc,cpm,frequency,reach', date_preset: 'last_30d' }
          })).data.data?.[0] || {};
          const ac = parseFloat((asIns.actions||[]).find(a=>a.action_type==='purchase')?.value||0);
          const ar = parseFloat((asIns.action_values||[]).find(a=>a.action_type==='purchase')?.value||0);
          const asp = parseFloat(asIns.spend||0);
          asm = { spend:asp, impressions:parseInt(asIns.impressions||0), clicks:parseInt(asIns.clicks||0),
                  conversions:ac, revenue:ar, ctr:parseFloat(asIns.ctr||0), cpc:parseFloat(asIns.cpc||0),
                  cpm:parseFloat(asIns.cpm||0), frequency:parseFloat(asIns.frequency||0), reach:parseInt(asIns.reach||0),
                  roas:asp>0?ar/asp:0, cpa:ac>0?asp/ac:0 };
        } catch {}
        const campRowId = queryOne('SELECT id FROM campaigns WHERE external_id=? AND ad_account_id=?', [mc.id, account.id])?.id;
        const exAs = queryOne('SELECT id FROM ad_sets WHERE external_id=? AND ad_account_id=?', [as.id, account.id]);
        if (exAs) {
          run(`UPDATE ad_sets SET name=?,status=?,spend=?,impressions=?,clicks=?,conversions=?,revenue=?,ctr=?,cpc=?,cpm=?,cpa=?,roas=?,frequency=?,reach=? WHERE id=?`,
            [as.name, as.status?.toLowerCase(), asm.spend||0, asm.impressions||0, asm.clicks||0,
             asm.conversions||0, asm.revenue||0, asm.ctr||0, asm.cpc||0, asm.cpm||0, asm.cpa||0,
             asm.roas||0, asm.frequency||0, asm.reach||0, exAs.id]);
        } else {
          run(`INSERT INTO ad_sets (campaign_id,ad_account_id,external_id,name,platform,status,daily_budget,targeting,spend,impressions,clicks,conversions,revenue,ctr,cpc,cpm,cpa,roas,frequency,reach)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [campRowId, account.id, as.id, as.name, 'meta', as.status?.toLowerCase(),
             (as.daily_budget||0)/100, JSON.stringify(as.targeting||{}),
             asm.spend||0, asm.impressions||0, asm.clicks||0, asm.conversions||0, asm.revenue||0,
             asm.ctr||0, asm.cpc||0, asm.cpm||0, asm.cpa||0, asm.roas||0, asm.frequency||0, asm.reach||0]);
        }
      }
    } catch {}
  }
}

// ─── GOOGLE ADS SYNC ─────────────────────────────────────────
async function syncGoogle(account, creds) {
  const { GoogleAdsApi } = require('google-ads-api');
  const client = new GoogleAdsApi({
    client_id:     creds.clientId,
    client_secret: creds.clientSecret,
    developer_token: creds.devToken,
  });
  const customer = client.Customer({
    customer_id:   account.account_id.replace(/-/g,''),
    refresh_token: creds.refreshToken,
  });

  const camps = await customer.query(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.amount_micros,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value,
           metrics.ctr, metrics.average_cpc, metrics.search_impression_share
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `);

  for (const row of camps) {
    const c   = row.campaign;
    const m   = row.metrics;
    const bud = row.campaign_budget;
    const sp  = (m.cost_micros || 0) / 1e6;
    const rev = m.conversions_value || 0;
    const conv= m.conversions || 0;

    const existing = queryOne('SELECT id FROM campaigns WHERE external_id=? AND ad_account_id=?', [String(c.id), account.id]);
    const campData = [
      c.name, c.status?.toLowerCase().replace('_',' '),
      (bud?.amount_micros||0)/1e6,
      sp, m.impressions||0, m.clicks||0, conv, rev,
      parseFloat(m.ctr||0)*100, (m.average_cpc||0)/1e6, 0,
      conv>0?sp/conv:0, sp>0?rev/sp:0, 0, 0
    ];
    if (existing) {
      run(`UPDATE campaigns SET name=?,status=?,daily_budget=?,spend=?,impressions=?,clicks=?,conversions=?,revenue=?,ctr=?,cpc=?,cpm=?,cpa=?,roas=?,frequency=?,reach=?,last_updated=datetime('now') WHERE id=?`,
        [...campData, existing.id]);
    } else {
      run(`INSERT INTO campaigns (ad_account_id,external_id,name,platform,objective,status,daily_budget,spend,impressions,clicks,conversions,revenue,ctr,cpc,cpm,cpa,roas,frequency,reach)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [account.id, String(c.id), c.name, 'google', c.advertising_channel_type||'SEARCH',
         c.status?.toLowerCase().replace('_',' '), (bud?.amount_micros||0)/1e6,
         sp, m.impressions||0, m.clicks||0, conv, rev,
         parseFloat(m.ctr||0)*100, (m.average_cpc||0)/1e6, 0,
         conv>0?sp/conv:0, sp>0?rev/sp:0, 0, 0]);
    }
  }
}

// ─── SETUP PAGE ──────────────────────────────────────────────
app.get('/setup', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

// ─── CRON ────────────────────────────────────────────────────
cron.schedule('*/10 * * * *', async () => {
  console.log('⏰ Scheduled sync...');
  const accounts = query("SELECT * FROM ad_accounts WHERE status='active'");
  for (const acc of accounts) {
    // Find user for this account
    const userId = acc.user_id;
    await syncAccount(acc, userId).catch(console.error);
  }
});

// ─── START ───────────────────────────────────────────────────
async function start() {
  await getDb();
  await seedIfEmpty();
  server.listen(PORT, () => {
    console.log(`🚀 AdSignal v2 running on http://localhost:${PORT}`);
    console.log(`🔧 Setup page: http://localhost:${PORT}/setup`);
    console.log(`👤 Demo: demo@adsignal.io / demo1234`);
  });
}

start();
