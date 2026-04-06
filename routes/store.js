// routes/store.js
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function safeJson(v, fallback) {
  if (!v) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch(e) { return fallback; }
}

// ── DASHBOARD STATS ────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const db = getDB();
    const sid = req.storeId;
    const [orders, customers, products, chart] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE store_id=? AND status!='cancelled'`, args:[sid] }),
      db.execute({ sql: `SELECT COUNT(*) as count FROM customers WHERE store_id=?`, args:[sid] }),
      db.execute({ sql: `SELECT COUNT(*) as count FROM products WHERE store_id=? AND status='active'`, args:[sid] }),
      Promise.all(Array.from({length:7},(_,i)=>{
        const d=new Date(); d.setDate(d.getDate()-(6-i));
        const ds=d.toISOString().split('T')[0];
        return db.execute({ sql:`SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue FROM orders WHERE store_id=? AND date(created_at)=? AND status!='cancelled'`, args:[sid,ds] })
          .then(r=>({date:ds, orders:r.rows[0].orders||0, revenue:r.rows[0].revenue||0}));
      }))
    ]);
    res.json({
      revenue: orders.rows[0].revenue||0, orders: orders.rows[0].count||0,
      customers: customers.rows[0].count||0, products: products.rows[0].count||0,
      chartData: chart
    });
  } catch(err) { console.error(err); res.status(500).json({ error:'Failed to fetch stats.' }); }
});

// ── GET STORE INFO ─────────────────────────────────────────────────────────────
router.get('/info', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql:'SELECT * FROM stores WHERE id=?', args:[req.storeId] });
    if (!result.rows.length) return res.status(404).json({ error:'Store not found.' });
    const store = result.rows[0];
    store.shipping_zones = safeJson(store.shipping_zones, []);
    store.theme_settings = safeJson(store.theme_settings, {});
    res.json(store);
  } catch(err) { res.status(500).json({ error:'Failed to fetch store info.' }); }
});

// ── UPDATE STORE INFO ──────────────────────────────────────────────────────────
router.patch('/info', async (req, res) => {
  try {
    const db = getDB();
    const {
      name, description, category, currency,
      logo_url, favicon_url,
      announcement_bar, announcement_bar_enabled,
      primary_color, accent_color,
      tax_rate, tax_included, tax_enabled,
      shipping_zones, theme_settings
    } = req.body;
    await db.execute({
      sql:`UPDATE stores SET
        name=COALESCE(?,name), description=COALESCE(?,description),
        category=COALESCE(?,category), currency=COALESCE(?,currency),
        logo_url=COALESCE(?,logo_url), favicon_url=COALESCE(?,favicon_url),
        announcement_bar=COALESCE(?,announcement_bar),
        announcement_bar_enabled=COALESCE(?,announcement_bar_enabled),
        primary_color=COALESCE(?,primary_color), accent_color=COALESCE(?,accent_color),
        tax_rate=COALESCE(?,tax_rate), tax_included=COALESCE(?,tax_included),
        tax_enabled=COALESCE(?,tax_enabled),
        shipping_zones=COALESCE(?,shipping_zones),
        theme_settings=COALESCE(?,theme_settings),
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      args:[
        name||null, description||null, category||null, currency||null,
        logo_url!==undefined?logo_url||null:null,
        favicon_url!==undefined?favicon_url||null:null,
        announcement_bar!==undefined?announcement_bar||null:null,
        announcement_bar_enabled!==undefined?(announcement_bar_enabled?1:0):null,
        primary_color||null, accent_color||null,
        tax_rate!==undefined?parseFloat(tax_rate)||0:null,
        tax_included!==undefined?(tax_included?1:0):null,
        tax_enabled!==undefined?(tax_enabled?1:0):null,
        shipping_zones!==undefined?JSON.stringify(shipping_zones):null,
        theme_settings!==undefined?JSON.stringify(theme_settings):null,
        req.storeId
      ]
    });
    const updated = await db.execute({ sql:'SELECT * FROM stores WHERE id=?', args:[req.storeId] });
    const s = updated.rows[0];
    s.shipping_zones = safeJson(s.shipping_zones, []);
    s.theme_settings = safeJson(s.theme_settings, {});
    res.json(s);
  } catch(err) { console.error(err); res.status(500).json({ error:'Failed to update store.' }); }
});

// ── SHIPPING ───────────────────────────────────────────────────────────────────
router.get('/shipping', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql:'SELECT shipping_zones FROM stores WHERE id=?', args:[req.storeId] });
    let zones = safeJson(result.rows[0]?.shipping_zones, []);
    // Migrate old flat zones to new multi-rate format
    zones = zones.map(z => ({
      ...z,
      rates: z.rates || [{ id: z.id||'r1', name: z.name||'Standard', rate: z.rate||0, free_over: z.free_over||null }]
    }));
    res.json({ zones });
  } catch(err) { res.status(500).json({ error:'Failed to fetch shipping.' }); }
});

router.patch('/shipping', async (req, res) => {
  try {
    const db = getDB();
    const { zones } = req.body;
    if (!zones) return res.status(400).json({ error:'zones required' });
    await db.execute({
      sql:'UPDATE stores SET shipping_zones=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      args:[JSON.stringify(zones), req.storeId]
    });
    res.json({ zones, message:'Shipping updated.' });
  } catch(err) { res.status(500).json({ error:'Failed to update shipping.' }); }
});

// ── TAX SETTINGS ───────────────────────────────────────────────────────────────
router.get('/tax', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql:'SELECT tax_rate, tax_included, tax_enabled FROM stores WHERE id=?', args:[req.storeId] });
    res.json(result.rows[0] || { tax_rate:0, tax_included:0, tax_enabled:0 });
  } catch(err) { res.status(500).json({ error:'Failed to fetch tax settings.' }); }
});

router.patch('/tax', async (req, res) => {
  try {
    const db = getDB();
    const { tax_rate, tax_included, tax_enabled } = req.body;
    await db.execute({
      sql:'UPDATE stores SET tax_rate=COALESCE(?,tax_rate), tax_included=COALESCE(?,tax_included), tax_enabled=COALESCE(?,tax_enabled), updated_at=CURRENT_TIMESTAMP WHERE id=?',
      args:[tax_rate!==undefined?parseFloat(tax_rate)||0:null, tax_included!==undefined?(tax_included?1:0):null, tax_enabled!==undefined?(tax_enabled?1:0):null, req.storeId]
    });
    res.json({ message:'Tax settings updated.' });
  } catch(err) { res.status(500).json({ error:'Failed to update tax.' }); }
});

// ── THEME SETTINGS ─────────────────────────────────────────────────────────────
router.get('/theme', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql:'SELECT theme_settings, primary_color, accent_color, logo_url, favicon_url, announcement_bar, announcement_bar_enabled FROM stores WHERE id=?', args:[req.storeId] });
    if (!result.rows.length) return res.status(404).json({ error:'Store not found.' });
    const row = result.rows[0];
    res.json({ ...row, theme_settings: safeJson(row.theme_settings, {}) });
  } catch(err) { res.status(500).json({ error:'Failed to fetch theme.' }); }
});

router.patch('/theme', async (req, res) => {
  try {
    const db = getDB();
    const { primary_color, accent_color, logo_url, favicon_url, announcement_bar, announcement_bar_enabled, theme_settings } = req.body;
    await db.execute({
      sql:`UPDATE stores SET
        primary_color=COALESCE(?,primary_color), accent_color=COALESCE(?,accent_color),
        logo_url=COALESCE(?,logo_url), favicon_url=COALESCE(?,favicon_url),
        announcement_bar=COALESCE(?,announcement_bar),
        announcement_bar_enabled=COALESCE(?,announcement_bar_enabled),
        theme_settings=COALESCE(?,theme_settings),
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      args:[primary_color||null, accent_color||null,
        logo_url!==undefined?logo_url||null:null,
        favicon_url!==undefined?favicon_url||null:null,
        announcement_bar!==undefined?announcement_bar||null:null,
        announcement_bar_enabled!==undefined?(announcement_bar_enabled?1:0):null,
        theme_settings!==undefined?JSON.stringify(theme_settings):null,
        req.storeId]
    });
    res.json({ message:'Theme updated.' });
  } catch(err) { res.status(500).json({ error:'Failed to update theme.' }); }
});

// ── POLICIES ───────────────────────────────────────────────────────────────────
router.get('/policies', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql:`SELECT * FROM store_pages WHERE store_id=? AND template='policy' ORDER BY title`, args:[req.storeId] });
    res.json({ policies: result.rows });
  } catch(err) { res.status(500).json({ error:'Failed to fetch policies.' }); }
});

// ── SETTINGS alias ─────────────────────────────────────────────────────────────
router.patch('/settings', async (req, res) => {
  try {
    const db = getDB();
    const { name, description, category, currency, storeName } = req.body;
    await db.execute({
      sql:'UPDATE stores SET name=COALESCE(?,name), description=COALESCE(?,description), category=COALESCE(?,category), currency=COALESCE(?,currency), updated_at=CURRENT_TIMESTAMP WHERE id=?',
      args:[name||storeName||null, description||null, category||null, currency||null, req.storeId]
    });
    const updated = await db.execute({ sql:'SELECT * FROM stores WHERE id=?', args:[req.storeId] });
    res.json(updated.rows[0]);
  } catch(err) { console.error(err); res.status(500).json({ error:'Failed to update settings.' }); }
});

module.exports = router;
