// routes/analytics-tracker.js — Real-time visitor & event tracking
// Public endpoints (no auth) for storefront tracking
// Admin endpoints (auth required) for reading data
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// ── Ensure tracking tables exist ────────────────────────────────────────────
async function ensureTables(db) {
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS page_views (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      session_id TEXT,
      page TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      user_agent TEXT,
      country TEXT,
      ip_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, args: []
  });
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS active_sessions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      page TEXT,
      cart_value REAL DEFAULT 0,
      cart_items INTEGER DEFAULT 0,
      country TEXT,
      city TEXT,
      user_agent TEXT,
      referrer TEXT
    )`, args: []
  });
  try {
    await db.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_pageviews_store ON page_views(store_id, created_at)`, args: [] });
    await db.execute({ sql: `CREATE INDEX IF NOT EXISTS idx_sessions_store ON active_sessions(store_id, last_seen)`, args: [] });
  } catch(e) {}
}

// ── HASH IP for privacy (never store raw IP) ────────────────────────────────
function hashIP(ip) {
  if (!ip) return null;
  // Simple hash — not cryptographic, just for grouping
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return 'h_' + Math.abs(hash).toString(36);
}

// ── PUBLIC: Track page view ─────────────────────────────────────────────────
router.post('/track', async (req, res) => {
  try {
    const db = getDB();
    await ensureTables(db);
    const { storeSlug, sessionId, page, referrer, utm_source, utm_medium, utm_campaign, cartValue, cartItems, country, city } = req.body;
    if (!storeSlug) return res.json({ ok: true });

    // Get store ID
    const storeResult = await db.execute({ sql: 'SELECT id FROM stores WHERE slug=?', args: [storeSlug] });
    if (!storeResult.rows.length) return res.json({ ok: true });
    const storeId = storeResult.rows[0].id;

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
    const ipHash = hashIP(ip);
    const ua = (req.headers['user-agent'] || '').slice(0, 200);
    const sid = sessionId || uuid();

    // Record page view
    await db.execute({
      sql: `INSERT INTO page_views (id, store_id, session_id, page, referrer, utm_source, utm_medium, utm_campaign, user_agent, country, ip_hash)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [uuid(), storeId, sid, page || '/', referrer || null, utm_source || null, utm_medium || null, utm_campaign || null, ua, country || null, ipHash]
    });

    // Upsert active session
    const existing = await db.execute({ sql: 'SELECT id FROM active_sessions WHERE id=? AND store_id=?', args: [sid, storeId] });
    if (existing.rows.length) {
      await db.execute({
        sql: `UPDATE active_sessions SET last_seen=CURRENT_TIMESTAMP, page=?, cart_value=?, cart_items=? WHERE id=?`,
        args: [page || '/', cartValue || 0, cartItems || 0, sid]
      });
    } else {
      await db.execute({
        sql: `INSERT INTO active_sessions (id, store_id, page, cart_value, cart_items, country, city, user_agent, referrer)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [sid, storeId, page || '/', cartValue || 0, cartItems || 0, country || null, city || null, ua, referrer || null]
      });
    }

    res.json({ ok: true, sessionId: sid });
  } catch(e) {
    // Analytics should never block the user experience
    res.json({ ok: true });
  }
});

// ── PUBLIC: Heartbeat (keep session alive) ──────────────────────────────────
router.post('/heartbeat', async (req, res) => {
  try {
    const db = getDB();
    const { storeSlug, sessionId, page, cartValue, cartItems } = req.body;
    if (!storeSlug || !sessionId) return res.json({ ok: true });
    const storeResult = await db.execute({ sql: 'SELECT id FROM stores WHERE slug=?', args: [storeSlug] });
    if (!storeResult.rows.length) return res.json({ ok: true });
    await db.execute({
      sql: `UPDATE active_sessions SET last_seen=CURRENT_TIMESTAMP, page=COALESCE(?,page), cart_value=COALESCE(?,cart_value), cart_items=COALESCE(?,cart_items) WHERE id=? AND store_id=?`,
      args: [page || null, cartValue !== undefined ? cartValue : null, cartItems !== undefined ? cartItems : null, sessionId, storeResult.rows[0].id]
    });
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

// ── PUBLIC: Track specific event ────────────────────────────────────────────
router.post('/event', async (req, res) => {
  try {
    const db = getDB();
    await ensureTables(db);
    const { storeSlug, sessionId, eventType, data } = req.body;
    if (!storeSlug || !eventType) return res.json({ ok: true });
    const storeResult = await db.execute({ sql: 'SELECT id FROM stores WHERE slug=?', args: [storeSlug] });
    if (!storeResult.rows.length) return res.json({ ok: true });
    const storeId = storeResult.rows[0].id;
    await db.execute({
      sql: `INSERT INTO analytics_events (id, store_id, event_type, session_id, data)
            VALUES (?,?,?,?,?)`,
      args: [uuid(), storeId, eventType, sessionId || null, data ? JSON.stringify(data) : null]
    });
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

// ── ADMIN: Live dashboard data ──────────────────────────────────────────────
router.get('/live', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    await ensureTables(db);
    const sid = req.storeId;

    // Clean old sessions (older than 5 minutes = not active)
    await db.execute({
      sql: `DELETE FROM active_sessions WHERE store_id=? AND last_seen < datetime('now', '-5 minutes')`,
      args: [sid]
    });

    // Active visitors right now
    const activeResult = await db.execute({
      sql: `SELECT * FROM active_sessions WHERE store_id=? ORDER BY last_seen DESC`,
      args: [sid]
    });
    const activeSessions = activeResult.rows;

    // Page views in last 30 minutes
    const recentViews = await db.execute({
      sql: `SELECT COUNT(*) as count FROM page_views WHERE store_id=? AND created_at >= datetime('now', '-30 minutes')`,
      args: [sid]
    });

    // Page views today
    const todayViews = await db.execute({
      sql: `SELECT COUNT(*) as count FROM page_views WHERE store_id=? AND date(created_at) = date('now')`,
      args: [sid]
    });

    // Unique sessions today
    const todaySessions = await db.execute({
      sql: `SELECT COUNT(DISTINCT session_id) as count FROM page_views WHERE store_id=? AND date(created_at) = date('now')`,
      args: [sid]
    });

    // Top pages right now
    const topPages = await db.execute({
      sql: `SELECT page, COUNT(*) as views FROM page_views WHERE store_id=? AND created_at >= datetime('now', '-30 minutes') GROUP BY page ORDER BY views DESC LIMIT 10`,
      args: [sid]
    });

    // Visitor locations
    const locations = await db.execute({
      sql: `SELECT country, COUNT(DISTINCT session_id) as visitors FROM page_views WHERE store_id=? AND date(created_at) = date('now') AND country IS NOT NULL GROUP BY country ORDER BY visitors DESC LIMIT 10`,
      args: [sid]
    });

    // Referrer sources today
    const sources = await db.execute({
      sql: `SELECT COALESCE(utm_source, CASE WHEN referrer IS NOT NULL AND referrer != '' THEN referrer ELSE 'direct' END) as source, COUNT(DISTINCT session_id) as visitors FROM page_views WHERE store_id=? AND date(created_at) = date('now') GROUP BY source ORDER BY visitors DESC LIMIT 10`,
      args: [sid]
    });

    // Behavior funnel: how many sessions viewed, added to cart, checked out, purchased
    const viewing = activeSessions.length;
    const inCart = activeSessions.filter(s => s.cart_items > 0).length;

    // Orders today
    const todayOrders = await db.execute({
      sql: `SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE store_id=? AND date(created_at) = date('now') AND status != 'cancelled'`,
      args: [sid]
    });

    res.json({
      activeVisitors: viewing,
      inCart,
      recentPageViews: recentViews.rows[0].count,
      todayPageViews: todayViews.rows[0].count,
      todaySessions: todaySessions.rows[0].count,
      todayOrders: todayOrders.rows[0].count,
      todayRevenue: todayOrders.rows[0].revenue,
      activeSessions: activeSessions.map(s => ({
        page: s.page,
        cartValue: s.cart_value,
        cartItems: s.cart_items,
        country: s.country,
        city: s.city,
        lastSeen: s.last_seen,
      })),
      topPages: topPages.rows,
      locations: locations.rows,
      sources: sources.rows,
    });
  } catch(e) {
    console.error('Live analytics error:', e);
    res.status(500).json({ error: 'Failed to load live data' });
  }
});

// ── ADMIN: Analytics overview with real data ────────────────────────────────
router.get('/traffic', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    await ensureTables(db);
    const sid = req.storeId;
    const { days = 30 } = req.query;
    const d = parseInt(days);
    const since = new Date();
    since.setDate(since.getDate() - d);
    const sinceStr = since.toISOString();

    // Page views over time
    const viewsOverTime = await db.execute({
      sql: `SELECT date(created_at) as date, COUNT(*) as views, COUNT(DISTINCT session_id) as sessions
            FROM page_views WHERE store_id=? AND created_at >= ?
            GROUP BY date(created_at) ORDER BY date ASC`,
      args: [sid, sinceStr]
    });

    // Total page views
    const totalViews = await db.execute({
      sql: `SELECT COUNT(*) as views, COUNT(DISTINCT session_id) as sessions, COUNT(DISTINCT ip_hash) as unique_visitors
            FROM page_views WHERE store_id=? AND created_at >= ?`,
      args: [sid, sinceStr]
    });

    // Top referrers
    const referrers = await db.execute({
      sql: `SELECT COALESCE(utm_source, CASE WHEN referrer IS NOT NULL AND referrer != '' THEN referrer ELSE 'direct' END) as source,
            COALESCE(utm_medium, 'none') as medium,
            COUNT(*) as views, COUNT(DISTINCT session_id) as sessions
            FROM page_views WHERE store_id=? AND created_at >= ?
            GROUP BY source, medium ORDER BY sessions DESC LIMIT 20`,
      args: [sid, sinceStr]
    });

    // Top pages
    const topPagesList = await db.execute({
      sql: `SELECT page, COUNT(*) as views, COUNT(DISTINCT session_id) as sessions
            FROM page_views WHERE store_id=? AND created_at >= ?
            GROUP BY page ORDER BY views DESC LIMIT 20`,
      args: [sid, sinceStr]
    });

    // Conversion rate: sessions that became orders / total sessions
    const orderSessions = await db.execute({
      sql: `SELECT COUNT(DISTINCT ae.session_id) as converting_sessions
            FROM analytics_events ae WHERE ae.store_id=? AND ae.event_type='order_placed' AND ae.created_at >= ?`,
      args: [sid, sinceStr]
    });

    const totalSessions = totalViews.rows[0].sessions || 1;
    const convertingSessions = orderSessions.rows[0].converting_sessions || 0;
    const conversionRate = totalSessions > 0 ? ((convertingSessions / totalSessions) * 100).toFixed(2) : '0.00';

    res.json({
      period_days: d,
      total_views: totalViews.rows[0].views,
      total_sessions: totalViews.rows[0].sessions,
      unique_visitors: totalViews.rows[0].unique_visitors,
      conversion_rate: parseFloat(conversionRate),
      views_over_time: viewsOverTime.rows,
      referrers: referrers.rows,
      top_pages: topPagesList.rows,
    });
  } catch(e) {
    console.error('Traffic analytics error:', e);
    res.status(500).json({ error: 'Failed to load traffic data' });
  }
});

module.exports = router;
