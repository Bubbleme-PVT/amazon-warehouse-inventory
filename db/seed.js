// ============================================================
// AdSignal — Seed Demo Data into SQLite
// ============================================================
const { query, queryOne, run } = require('./database');
const bcrypt = require('bcryptjs');

function rnd(mn, mx) {
  return Math.round(mn + Math.random() * (mx - mn));
}
function rndF(mn, mx, d = 2) {
  return parseFloat((mn + Math.random() * (mx - mn)).toFixed(d));
}

function metrics(budget) {
  const sp = rndF(budget * 0.65, budget * 0.98);
  const imp = rnd(50000, 400000);
  const cl = rnd(1000, 12000);
  const conv = rnd(20, 350);
  const rev = rndF(80000, 500000);
  return {
    spend: sp, impressions: imp, clicks: cl, conversions: conv, revenue: rev,
    ctr: parseFloat((cl / imp * 100).toFixed(2)),
    cpc: parseFloat((sp / cl).toFixed(2)),
    cpm: parseFloat((sp / imp * 1000).toFixed(2)),
    cpa: parseFloat((sp / conv).toFixed(2)),
    roas: parseFloat((rev / sp).toFixed(2)),
    frequency: rndF(1.1, 4.8),
    reach: rnd(20000, 180000),
  };
}

async function seedIfEmpty() {
  const existing = queryOne('SELECT id FROM users WHERE email = ?', ['demo@adsignal.io']);
  if (existing) return;

  console.log('🌱 Seeding demo data...');

  // Create demo user
  const hashed = await bcrypt.hash('demo1234', 10);
  run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', ['Demo User', 'demo@adsignal.io', hashed]);
  const user = queryOne('SELECT id FROM users WHERE email = ?', ['demo@adsignal.io']);
  const userId = user.id;

  // Ad Accounts
  const accounts = [
    { name: 'Zara India', platform: 'google', account_id: 'g-001', color: '#4285f4', status: 'active' },
    { name: 'Brand Campaigns', platform: 'google', account_id: 'g-002', color: '#34a853', status: 'active' },
    { name: 'Zara India — Meta', platform: 'meta', account_id: 'm-001', color: '#1877f2', status: 'active' },
    { name: 'Performance Max', platform: 'meta', account_id: 'm-002', color: '#e1306c', status: 'paused' },
  ];

  const accIds = {};
  accounts.forEach(acc => {
    run(
      `INSERT INTO ad_accounts (user_id, name, platform, account_id, color, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, acc.name, acc.platform, acc.account_id, acc.color, acc.status]
    );
    const inserted = queryOne('SELECT id FROM ad_accounts WHERE account_id = ? AND user_id = ?', [acc.account_id, userId]);
    accIds[acc.account_id] = inserted.id;
  });

  const creatives = [
    { hl: 'Summer Sale — Up to 50% Off', body: 'Shop the latest collection now. Limited time offer on all categories.', img: '🛍️', cta: 'Shop Now', url: 'zara.com/in' },
    { hl: 'New Arrivals This Week', body: 'Discover fresh styles for every occasion. Free shipping on orders above ₹999.', img: '👗', cta: 'Browse Now', url: 'zara.com/in/new' },
    { hl: 'Exclusive Member Offer', body: 'Get early access to our biggest sale. Members save an extra 10%.', img: '🎁', cta: 'Claim Offer', url: 'zara.com/in/members' },
    { hl: 'Trendsetter Collection 2024', body: "Be the first to wear what's next. Curated by our top designers.", img: '✨', cta: 'View Collection', url: 'zara.com/in/trend' },
  ];

  const fmts = ['Single Image', 'Carousel', 'Video', 'Collection', 'Story'];
  const rankings = ['BELOW_AVERAGE', 'AVERAGE', 'ABOVE_AVERAGE'];

  const campaignDefs = [
    { accKey: 'g-001', name: 'Brand Search — India', obj: 'Conversions', type: 'Search', budget: 8000, status: 'active', adsets: ['Brand Exact', 'Brand Broad'] },
    { accKey: 'g-001', name: 'Shopping — All Products', obj: 'Sales', type: 'Shopping', budget: 12000, status: 'active', adsets: ['All Products', 'Top Sellers', 'Clearance'] },
    { accKey: 'g-001', name: 'Display Retargeting', obj: 'Conversions', type: 'Display', budget: 4500, status: 'active', adsets: ['7-day visitors', '30-day visitors', 'Cart'] },
    { accKey: 'g-002', name: 'Competitor Keywords', obj: 'Traffic', type: 'Search', budget: 6000, status: 'active', adsets: ['Competitor A', 'Competitor B'] },
    { accKey: 'g-002', name: 'YouTube Awareness', obj: 'Awareness', type: 'Video', budget: 5000, status: 'paused', adsets: ['18-34 Fashion', '25-45 Premium'] },
    { accKey: 'm-001', name: 'Prospecting — Broad India', obj: 'Traffic', type: 'Awareness', budget: 9000, status: 'active', adsets: ['18-24 Women India', '25-34 Mumbai', '35-44 Delhi'] },
    { accKey: 'm-001', name: 'Retargeting — Cart Abandoners', obj: 'Conversions', type: 'Retargeting', budget: 7000, status: 'active', adsets: ['Cart 1-day', 'Cart 3-day', 'Cart 7-day'] },
    { accKey: 'm-001', name: 'Lookalike 1% — Top Buyers', obj: 'Sales', type: 'Lookalike', budget: 6500, status: 'active', adsets: ['LAL 1%', 'LAL 2%'] },
    { accKey: 'm-001', name: 'Seasonal Sale — Summer', obj: 'Sales', type: 'Catalog', budget: 8000, status: 'paused', adsets: ['Sale Seekers', 'Past Buyers'] },
    { accKey: 'm-002', name: 'App Install — Android', obj: 'App', type: 'App', budget: 5000, status: 'paused', adsets: ['Android 8+ India', 'Budget Devices'] },
    { accKey: 'm-002', name: 'Lead Gen — Tier 2', obj: 'Leads', type: 'Lead Gen', budget: 4000, status: 'paused', adsets: ['Mumbai', 'Delhi', 'Bangalore'] },
  ];

  campaignDefs.forEach(cd => {
    const accId = accIds[cd.accKey];
    const platform = cd.accKey.startsWith('g') ? 'google' : 'meta';
    const m = metrics(cd.budget);

    run(
      `INSERT INTO campaigns (ad_account_id, name, platform, objective, type, status, daily_budget,
        spend, impressions, clicks, conversions, revenue, ctr, cpc, cpm, cpa, roas, frequency, reach)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [accId, cd.name, platform, cd.obj, cd.type, cd.status, cd.budget,
        m.spend, m.impressions, m.clicks, m.conversions, m.revenue,
        m.ctr, m.cpc, m.cpm, m.cpa, m.roas, m.frequency, m.reach]
    );
    const camp = queryOne('SELECT id FROM campaigns WHERE name = ? AND ad_account_id = ?', [cd.name, accId]);

    cd.adsets.forEach(asName => {
      const asm = metrics(3000);
      const asStatus = Math.random() > 0.2 ? 'active' : 'paused';
      run(
        `INSERT INTO ad_sets (campaign_id, ad_account_id, name, platform, status, daily_budget, targeting,
          spend, impressions, clicks, conversions, revenue, ctr, cpc, cpm, cpa, roas, frequency, reach)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [camp.id, accId, asName, platform, asStatus, rnd(1000, 4000),
          platform === 'google' ? 'Keyword Match' : 'Interest + Behavior',
          asm.spend, asm.impressions, asm.clicks, asm.conversions, asm.revenue,
          asm.ctr, asm.cpc, asm.cpm, asm.cpa, asm.roas, asm.frequency, asm.reach]
      );
      const adset = queryOne('SELECT id FROM ad_sets WHERE name = ? AND campaign_id = ?', [asName, camp.id]);

      const numAds = rnd(2, 3);
      for (let i = 0; i < numAds; i++) {
        const cr = creatives[rnd(0, 3)];
        const adm = metrics(1500);
        const adStatus = Math.random() > 0.25 ? 'active' : (Math.random() > 0.5 ? 'paused' : 'archived');
        const adName = `Variant ${String.fromCharCode(65 + i)} — ${fmts[rnd(0, 4)]}`;
        run(
          `INSERT INTO ads (ad_set_id, campaign_id, ad_account_id, name, platform, status, format,
            creative_headline, creative_body, creative_image, creative_cta, creative_url,
            quality_ranking, engagement_ranking,
            spend, impressions, clicks, conversions, revenue, ctr, cpc, cpm, cpa, roas, frequency, reach)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [adset.id, camp.id, accId, adName, platform, adStatus, fmts[rnd(0, 4)],
            cr.hl, cr.body, cr.img, cr.cta, cr.url,
            rankings[rnd(0, 2)], rankings[rnd(0, 2)],
            adm.spend, adm.impressions, adm.clicks, adm.conversions, adm.revenue,
            adm.ctr, adm.cpc, adm.cpm, adm.cpa, adm.roas, adm.frequency, adm.reach]
        );
      }
    });
  });

  // Seed daily_metrics for the past 30 days
  const allCamps = query('SELECT id, platform FROM campaigns');
  for (const camp of allCamps) {
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dm_spend = rndF(8000, 22000);
      const dm_imp = rnd(40000, 200000);
      const dm_clicks = rnd(500, 8000);
      const dm_conv = rnd(5, 80);
      const dm_rev = rndF(20000, 100000);
      run(
        `INSERT INTO daily_metrics (entity_type, entity_id, platform, date, spend, impressions, clicks, conversions, revenue, roas, ctr)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ['campaign', camp.id, camp.platform, dateStr, dm_spend, dm_imp, dm_clicks, dm_conv, dm_rev,
          parseFloat((dm_rev / dm_spend).toFixed(2)),
          parseFloat((dm_clicks / dm_imp * 100).toFixed(2))]
      );
    }
  }

  console.log('✅ Demo data seeded!');
}

module.exports = { seedIfEmpty };
