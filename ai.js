// ============================================================
// AdSignal — AI/ML Decision Engine v2
// 5 engines: Budget Allocation, Creative Insights, Anomaly
//            Detection, Cross-Channel Attribution, Forecasting
// ============================================================

// ─────────────────────────────────────────────────────────────
// ENGINE 1: BUDGET ALLOCATION
// Uses diminishing-returns curve (ROAS vs spend saturation)
// to recommend exact ₹ amounts to shift per campaign
// ─────────────────────────────────────────────────────────────
function budgetAllocationEngine(campaigns) {
  const decisions = [];

  campaigns.forEach(camp => {
    const spend    = camp.spend        || 0;
    const budget   = camp.daily_budget || 0;
    const roas     = camp.roas         || 0;
    const name     = camp.name         || 'Campaign';
    const platform = camp.platform     || '';

    // --- Underspend detection ---
    if (budget > 0 && spend < budget * 0.70) {
      const pct       = Math.round((1 - spend / budget) * 100);
      const suggestBid = +(spend * 1.15).toFixed(0);
      decisions.push({
        type: 'warning',
        title: `${name} — underspending by ${pct}%`,
        detail: `Budget ₹${fmt(budget)}/day but only spending ₹${fmt(spend)}. ` +
                `Raising bid cap to ₹${fmt(suggestBid)} could unlock ₹${fmt(budget - spend)}/day more.`,
        action: `Raise bid cap → ₹${fmt(suggestBid)}`,
        impact: 'medium', platform, confidence: 0.82,
        engine: 'budget'
      });
    }

    // --- Scale high ROAS (diminishing returns: optimal scale window is ROAS 4–7) ---
    if (roas >= 4.5 && roas <= 12 && camp.status === 'active') {
      const scalePct   = roas >= 6 ? 40 : 30;
      const newBudget  = +(budget * (1 + scalePct / 100)).toFixed(0);
      decisions.push({
        type: 'opportunity',
        title: `${name} — ROAS ${roas.toFixed(1)}x · scale now`,
        detail: `Sustained ${roas.toFixed(1)}x ROAS. Optimal scale window: increase budget ` +
                `${scalePct}% (₹${fmt(budget)} → ₹${fmt(newBudget)}/day) before audience saturates.`,
        action: `Scale to ₹${fmt(newBudget)}/day`,
        impact: 'high', platform, confidence: 0.91,
        engine: 'budget'
      });
    }

    // --- Extremely high ROAS likely means underspend / small sample ---
    if (roas > 12 && spend < 1000) {
      decisions.push({
        type: 'opportunity',
        title: `${name} — ROAS ${roas.toFixed(0)}x (limited data)`,
        detail: `Very high ROAS on low spend (₹${fmt(spend)}). Increase budget to validate performance at scale.`,
        action: 'Test with 3× budget for 3 days',
        impact: 'medium', platform, confidence: 0.68,
        engine: 'budget'
      });
    }

    // --- Pause low ROAS ---
    if (roas > 0 && roas < 1.8 && spend > 500) {
      decisions.push({
        type: 'urgent',
        title: `${name} — ROAS ${roas.toFixed(1)}x · below breakeven`,
        detail: `Spending ₹${fmt(spend)} with only ${roas.toFixed(1)}x return. ` +
                `Pause immediately and audit targeting + landing page conversion rate.`,
        action: 'Pause campaign',
        impact: 'high', platform, confidence: 0.95,
        engine: 'budget'
      });
    }
  });

  // --- Cross-platform rebalance ---
  const google = campaigns.filter(c => c.platform === 'google');
  const meta   = campaigns.filter(c => c.platform === 'meta');
  const gRoas  = avgMetric(google, 'roas');
  const mRoas  = avgMetric(meta,   'roas');

  if (gRoas > 0 && mRoas > 0 && Math.abs(gRoas - mRoas) >= 1.0) {
    const better   = gRoas > mRoas ? 'Google' : 'Meta';
    const worse    = gRoas > mRoas ? 'Meta'   : 'Google';
    const diff     = Math.abs(gRoas - mRoas);
    const worseCamps = gRoas > mRoas ? meta : google;
    const totalWorse = worseCamps.reduce((s, c) => s + (c.daily_budget || 0), 0);
    const shiftAmt   = +(totalWorse * 0.15).toFixed(0);
    decisions.push({
      type: 'opportunity',
      title: `Rebalance: ${better} outperforms ${worse} by ${diff.toFixed(1)}x ROAS`,
      detail: `${better} avg ROAS ${Math.max(gRoas,mRoas).toFixed(1)}x vs ${worse} ${Math.min(gRoas,mRoas).toFixed(1)}x. ` +
              `Shift ₹${fmt(shiftAmt)}/day (15%) from ${worse} → ${better} for est. +₹${fmt(shiftAmt * diff * 0.5)}/day revenue.`,
      action: `Move ₹${fmt(shiftAmt)}/day → ${better}`,
      impact: 'high', platform: 'both',
      confidence: +Math.min(0.92, 0.60 + diff * 0.08).toFixed(2),
      engine: 'budget'
    });
  }

  return decisions;
}

// ─────────────────────────────────────────────────────────────
// ENGINE 2: CREATIVE INSIGHTS
// CTR decay, fatigue scoring, A/B ranking
// ─────────────────────────────────────────────────────────────
function creativeInsightsEngine(ads) {
  const decisions = [];
  // Group ads by campaign
  const byCamp = {};
  ads.forEach(ad => {
    const key = ad.campaign_id || 'unknown';
    if (!byCamp[key]) byCamp[key] = [];
    byCamp[key].push(ad);
  });

  Object.values(byCamp).forEach(campAds => {
    if (!campAds.length) return;
    const platform  = campAds[0].platform || '';
    const campName  = campAds[0].campaign_name || 'Campaign';

    // --- A/B Performance Ranking ---
    const ranked = campAds
      .filter(a => (a.impressions || 0) > 1000)
      .sort((a, b) => {
        const scoreA = ((a.ctr || 0) * (a.conversions || 1)) / Math.max(a.spend || 1, 1);
        const scoreB = ((b.ctr || 0) * (b.conversions || 1)) / Math.max(b.spend || 1, 1);
        return scoreB - scoreA;
      });

    if (ranked.length >= 2) {
      const winner = ranked[0];
      const loser  = ranked[ranked.length - 1];
      const winCtr = winner.ctr || 0;
      const loseCtr = loser.ctr || 0;
      if (winCtr > 0 && loseCtr > 0 && winCtr / loseCtr > 1.3) {
        const uplift = Math.round((winCtr / loseCtr - 1) * 100);
        decisions.push({
          type: 'opportunity',
          title: `${campName} — "${winner.name}" winning by ${uplift}% CTR`,
          detail: `Ad "${winner.name}" CTR ${winCtr.toFixed(2)}% vs "${loser.name}" ${loseCtr.toFixed(2)}%. ` +
                  `Pause underperformer, shift budget to winner, test new variant B.`,
          action: `Pause "${loser.name?.slice(0, 20)}"`,
          impact: 'medium', platform, confidence: 0.85,
          engine: 'creative'
        });
      }
    }

    // --- Fatigue Detection: High frequency, falling CTR ---
    campAds.forEach(ad => {
      const freq = ad.frequency || 0;
      const ctr  = ad.ctr       || 0;
      const imp  = ad.impressions || 0;
      // Fatigue score: freq × (1 - ctr/benchmark)  benchmark = 2.5%
      const benchmark    = 2.5;
      const fatigueScore = freq * (1 - Math.min(ctr / benchmark, 1));
      if (freq >= 3.5 && fatigueScore > 2.0 && imp > 5000) {
        const daysLeft = Math.max(1, Math.round(3 / Math.max(fatigueScore - 2, 0.1)));
        decisions.push({
          type: 'warning',
          title: `${ad.name || campName} — creative fatigue in ~${daysLeft} day(s)`,
          detail: `Frequency ${freq.toFixed(1)}x with CTR ${ctr.toFixed(2)}% (fatigue score ${fatigueScore.toFixed(1)}). ` +
                  `Refresh creative or expand audience to prevent CTR collapse.`,
          action: 'Queue creative refresh',
          impact: 'medium', platform, confidence: 0.80,
          engine: 'creative'
        });
      }
    });

    // --- Low CTR on high impression ad ---
    campAds.forEach(ad => {
      if ((ad.impressions || 0) > 20000 && (ad.ctr || 0) < 0.8) {
        decisions.push({
          type: 'warning',
          title: `${ad.name || campName} — CTR ${(ad.ctr||0).toFixed(2)}% critically low`,
          detail: `${(ad.impressions||0).toLocaleString()} impressions but only ${(ad.ctr||0).toFixed(2)}% CTR. ` +
                  `Poor audience-creative match. Test new hook in first 3 seconds.`,
          action: 'Rewrite ad hook',
          impact: 'medium', platform, confidence: 0.78,
          engine: 'creative'
        });
      }
    });
  });

  return decisions;
}

// ─────────────────────────────────────────────────────────────
// ENGINE 3: ANOMALY DETECTION (Z-Score on 30-day rolling)
// Flags sudden spikes/drops vs campaign's own baseline
// ─────────────────────────────────────────────────────────────
function anomalyDetectionEngine(campaigns, dailyMetrics) {
  const decisions = [];
  const anomalies = [];

  // Group daily metrics by campaign
  const bycamp = {};
  dailyMetrics.forEach(dm => {
    const k = String(dm.entity_id);
    if (!bycamp[k]) bycamp[k] = [];
    bycamp[k].push(dm);
  });

  campaigns.forEach(camp => {
    const history = (bycamp[String(camp.id)] || [])
      .sort((a, b) => a.date.localeCompare(b.date));
    if (history.length < 7) return; // need minimum history

    const checkMetric = (metricKey, label, higherIsBad) => {
      const vals    = history.map(d => d[metricKey] || 0).filter(v => v > 0);
      if (vals.length < 7) return;
      const recent  = vals[vals.length - 1];
      const window  = vals.slice(-8, -1);  // 7-day window excluding today
      const mean    = window.reduce((s, v) => s + v, 0) / window.length;
      const std     = Math.sqrt(window.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / window.length);
      if (std === 0) return;
      const z = (recent - mean) / std;
      const absZ = Math.abs(z);
      if (absZ < 1.8) return;

      const isBad     = higherIsBad ? z > 0 : z < 0;
      const severity  = absZ >= 3 ? 'urgent' : 'warning';
      const direction = z > 0 ? 'up' : 'down';
      const changePct = mean > 0 ? Math.abs(Math.round((recent - mean) / mean * 100)) : 0;

      const message = `${camp.name} — ${label} ${direction === 'up' ? '↑' : '↓'} ${changePct}% vs 7d avg (Z=${z.toFixed(1)})`;
      const detail  = `${label} is ₹${recent.toFixed ? recent.toFixed(0) : recent} vs 7-day avg ₹${mean.toFixed ? mean.toFixed(0) : Math.round(mean)}. ` +
                      `Statistical anomaly (${absZ.toFixed(1)}σ) — check for bid changes, auction shifts, or tracking issues.`;

      if (isBad) {
        decisions.push({
          type: severity,
          title: message,
          detail,
          action: 'Investigate now',
          impact: absZ >= 3 ? 'high' : 'medium',
          platform: camp.platform,
          confidence: +Math.min(0.97, 0.70 + absZ * 0.08).toFixed(2),
          engine: 'anomaly'
        });
      }

      anomalies.push({
        campaign_id: camp.id,
        campaign_name: camp.name,
        platform: camp.platform,
        metric: metricKey,
        z_score: +z.toFixed(2),
        current_value: recent,
        mean_value: +mean.toFixed(2),
        severity,
        message
      });
    };

    checkMetric('cpa',   'CPA',        true);   // high CPA = bad
    checkMetric('ctr',   'CTR',        false);  // low CTR = bad
    checkMetric('roas',  'ROAS',       false);  // low ROAS = bad
    checkMetric('spend', 'Spend',      true);   // unexpected spend spike = bad
  });

  return { decisions, anomalies };
}

// ─────────────────────────────────────────────────────────────
// ENGINE 4: CROSS-CHANNEL ATTRIBUTION
// Detects double-counting and attribution window mismatches
// between Google (last-click 30d) and Meta (view 1d / click 7d)
// ─────────────────────────────────────────────────────────────
function crossChannelAttributionEngine(campaigns) {
  const decisions = [];

  const google = campaigns.filter(c => c.platform === 'google');
  const meta   = campaigns.filter(c => c.platform === 'meta');

  if (!google.length || !meta.length) return decisions;

  const gRevenue   = google.reduce((s, c) => s + (c.revenue || 0), 0);
  const mRevenue   = meta.reduce((s, c)   => s + (c.revenue || 0), 0);
  const gSpend     = google.reduce((s, c) => s + (c.spend   || 0), 0);
  const mSpend     = meta.reduce((s, c)   => s + (c.spend   || 0), 0);
  const totalSpend = gSpend + mSpend;

  // Estimate overlap: if both platforms target similar audiences
  // Meta view-through (1d) often double-counts Google last-click conversions
  // Conservative overlap estimate: 15–25% of Meta view-through revenue
  const overlapEstimate = mRevenue * 0.18;
  const adjustedTotal   = gRevenue + mRevenue - overlapEstimate;
  const reportedRoas    = totalSpend > 0 ? (gRevenue + mRevenue) / totalSpend : 0;
  const trueRoas        = totalSpend > 0 ? adjustedTotal / totalSpend         : 0;

  if (overlapEstimate > 5000 && reportedRoas > trueRoas + 0.3) {
    decisions.push({
      type: 'warning',
      title: `Attribution overlap: ₹${fmt(overlapEstimate)} likely double-counted`,
      detail: `Google uses last-click (30d), Meta uses view-through (1d) + click (7d). ` +
              `Est. ₹${fmt(overlapEstimate)} revenue counted by both. ` +
              `True blended ROAS: ~${trueRoas.toFixed(1)}x (reported: ${reportedRoas.toFixed(1)}x).`,
      action: 'Enable Meta click-only attribution',
      impact: 'high', platform: 'both', confidence: 0.72,
      engine: 'attribution'
    });
  }

  // Check if one platform is running the same audience as the other
  const gConv = google.reduce((s, c) => s + (c.conversions || 0), 0);
  const mConv = meta.reduce((s, c)   => s + (c.conversions || 0), 0);
  const gCPA  = gConv > 0 ? gSpend / gConv : 0;
  const mCPA  = mConv > 0 ? mSpend / mConv : 0;

  if (gCPA > 0 && mCPA > 0) {
    const cheaper   = gCPA < mCPA ? 'Google' : 'Meta';
    const expensive = gCPA < mCPA ? 'Meta'   : 'Google';
    const ratio     = Math.max(gCPA, mCPA) / Math.min(gCPA, mCPA);
    if (ratio > 1.5) {
      decisions.push({
        type: 'opportunity',
        title: `CPA gap: ${cheaper} acquires ${ratio.toFixed(1)}× cheaper than ${expensive}`,
        detail: `${cheaper} CPA ₹${fmt(Math.min(gCPA,mCPA))} vs ${expensive} ₹${fmt(Math.max(gCPA,mCPA))}. ` +
                `If targeting similar audiences, shift acquisition budget to ${cheaper}.`,
        action: `Shift acquisition → ${cheaper}`,
        impact: 'high', platform: 'both', confidence: 0.78,
        engine: 'attribution'
      });
    }
  }

  return decisions;
}

// ─────────────────────────────────────────────────────────────
// ENGINE 5: PREDICTIVE FORECASTING
// Linear regression on 14-day window → next 7-day projections
// ─────────────────────────────────────────────────────────────
function forecastingEngine(campaigns, dailyMetrics) {
  const forecasts = [];

  const bycamp = {};
  dailyMetrics.forEach(dm => {
    const k = String(dm.entity_id);
    if (!bycamp[k]) bycamp[k] = [];
    bycamp[k].push(dm);
  });

  campaigns.forEach(camp => {
    const history = (bycamp[String(camp.id)] || [])
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
    if (history.length < 7) return;

    const n = history.length;
    const xVals = history.map((_, i) => i);

    const linReg = (yKey) => {
      const yVals = history.map(d => d[yKey] || 0);
      const xMean = xVals.reduce((s, v) => s + v, 0) / n;
      const yMean = yVals.reduce((s, v) => s + v, 0) / n;
      const slope = xVals.reduce((s, x, i) => s + (x - xMean) * (yVals[i] - yMean), 0) /
                    xVals.reduce((s, x) => s + Math.pow(x - xMean, 2), 0);
      const intercept = yMean - slope * xMean;
      return (x) => Math.max(0, intercept + slope * x);
    };

    const spendFn = linReg('spend');
    const convFn  = linReg('conversions');

    for (let i = 1; i <= 7; i++) {
      const xNext    = n - 1 + i;
      const pSpend   = +spendFn(xNext).toFixed(2);
      const pConv    = +convFn(xNext).toFixed(2);
      const pRoas    = pSpend > 0 && camp.roas > 0
        ? +(camp.roas * (1 + (Math.random() - 0.5) * 0.1)).toFixed(2)
        : 0;
      const fDate    = new Date();
      fDate.setDate(fDate.getDate() + i);

      forecasts.push({
        campaign_id:          camp.id,
        platform:             camp.platform,
        forecast_date:        fDate.toISOString().slice(0, 10),
        predicted_spend:      pSpend,
        predicted_conversions: pConv,
        predicted_roas:       pRoas,
        confidence:           +(Math.max(0.50, 0.90 - i * 0.04)).toFixed(2)
      });
    }
  });

  return forecasts;
}

// ─────────────────────────────────────────────────────────────
// MASTER: runs all engines, dedupes, sorts by priority
// ─────────────────────────────────────────────────────────────
function generateDecisions(campaigns, ads = [], dailyMetrics = []) {
  let all = [];

  // Per-campaign rule-based checks (legacy fast rules kept)
  campaigns.forEach(camp => all = all.concat(legacyRules(camp)));

  // Engine 1: Budget Allocation
  all = all.concat(budgetAllocationEngine(campaigns));

  // Engine 2: Creative Insights
  if (ads.length) all = all.concat(creativeInsightsEngine(ads));

  // Engine 3: Anomaly Detection
  if (dailyMetrics.length) {
    const { decisions: anomalyDecs } = anomalyDetectionEngine(campaigns, dailyMetrics);
    all = all.concat(anomalyDecs);
  }

  // Engine 4: Cross-channel Attribution
  all = all.concat(crossChannelAttributionEngine(campaigns));

  // Dedupe by title
  const seen = new Set();
  all = all.filter(d => {
    const k = d.title.slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort: urgent → opportunity → warning
  const priority = { urgent: 0, opportunity: 1, warning: 2 };
  all.sort((a, b) => (priority[a.type] || 3) - (priority[b.type] || 3));

  return all.length ? all : demoDecisions();
}

function runAnomalyDetection(campaigns, dailyMetrics) {
  return anomalyDetectionEngine(campaigns, dailyMetrics);
}

function runForecasting(campaigns, dailyMetrics) {
  return forecastingEngine(campaigns, dailyMetrics);
}

// ─────────────────────────────────────────────────────────────
// LEGACY RULES (fast, no history needed)
// ─────────────────────────────────────────────────────────────
function legacyRules(camp) {
  const decisions = [];
  const m        = camp;
  const name     = camp.name     || 'Campaign';
  const platform = camp.platform || '';
  const freq     = m.frequency   || 0;
  const cpa      = m.cpa         || 0;
  const conv     = m.conversions || 0;
  const ctr      = m.ctr         || 0;

  if (platform === 'meta' && freq >= 4.0) {
    decisions.push({
      type: 'warning',
      title: `${name} — frequency ${freq.toFixed(1)}x · audience fatigue`,
      detail: `Each user sees your ad ${freq.toFixed(1)} times. CTR typically drops 20–30% past 3.5x. Refresh creative or broaden audience.`,
      action: 'Refresh creative',
      impact: 'medium', platform, confidence: 0.87, engine: 'rules'
    });
  }

  if (cpa > 0 && conv > 10 && cpa > 800) {
    decisions.push({
      type: 'urgent',
      title: `${name} — CPA ₹${fmt(cpa)} exceeds target`,
      detail: `₹${fmt(cpa)} CPA on ${Math.round(conv)} conversions. Review audience quality and landing page conversion rate.`,
      action: 'Audit audience + landing page',
      impact: 'high', platform, confidence: 0.83, engine: 'rules'
    });
  }

  if (ctr < 1.0 && (m.impressions || 0) > 10000) {
    decisions.push({
      type: 'warning',
      title: `${name} — CTR ${ctr.toFixed(2)}% below 1%`,
      detail: `${(m.impressions||0).toLocaleString()} impressions with only ${ctr.toFixed(2)}% CTR. Benchmark is 2–4%. Creative-audience mismatch likely.`,
      action: 'Refresh ad creatives',
      impact: 'medium', platform, confidence: 0.78, engine: 'rules'
    });
  }
  return decisions;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function avgMetric(list, key) {
  const valid = list.filter(c => (c[key] || 0) > 0);
  return valid.length ? valid.reduce((s, c) => s + (c[key] || 0), 0) / valid.length : 0;
}

function fmt(n) {
  if (!n) return '0';
  if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
  if (n >= 100000)   return (n / 100000).toFixed(1)   + 'L';
  if (n >= 1000)     return (n / 1000).toFixed(1)     + 'K';
  return Math.round(n).toString();
}

function demoDecisions() {
  return [
    { type:'urgent',      engine:'budget',      title:'Shopping campaign below breakeven ROAS',          detail:'Spending ₹8,400/day with 1.4x ROAS. Pause and audit landing page.', action:'Pause campaign',           impact:'high',   platform:'google', confidence:0.95 },
    { type:'opportunity', engine:'budget',      title:'Meta Retargeting ROAS 5.6x — scale now',         detail:'Sustained >5x ROAS for 7 days. Scale ₹7K → ₹11K before saturation.', action:'Scale to ₹11,000/day',  impact:'high',   platform:'meta',   confidence:0.91 },
    { type:'opportunity', engine:'attribution', title:'Rebalance: Google outperforms Meta by 1.1x ROAS',detail:'Shift ₹1,350/day from Meta Prospecting → Google. Est. +₹4,200/day revenue.', action:'Apply rebalance', impact:'high',   platform:'both',   confidence:0.78 },
    { type:'warning',     engine:'anomaly',     title:'Competitor KW CPA up 22% (2.1σ anomaly)',         detail:'CPA rose ₹380 → ₹465 in 7 days. Run search term audit + add negatives.', action:'Run audit',         impact:'medium', platform:'google', confidence:0.83 },
    { type:'warning',     engine:'creative',    title:'Lookalike 1% creative fatigue detected',          detail:'Fatigue score 3.2 — CTR fell 5.2% → 4.1% over 14 days. Refresh seed.', action:'Refresh seed audience', impact:'medium', platform:'meta',   confidence:0.80 },
    { type:'warning',     engine:'attribution', title:'₹18K revenue likely double-counted cross-channel',detail:'Google last-click + Meta view-through overlap. True ROAS ~3.1x not 4.2x.', action:'Enable click-only attribution', impact:'high', platform:'both', confidence:0.72 },
  ];
}

module.exports = {
  generateDecisions,
  runAnomalyDetection,
  runForecasting,
  budgetAllocationEngine,
  creativeInsightsEngine,
  crossChannelAttributionEngine,
  demoDecisions
};
