// routes/analytics.js
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const db = getDB();
    const sid = req.storeId;
    const { days = 30, compare = false } = req.query;
    const d = parseInt(days);

    const since = new Date(); since.setDate(since.getDate() - d);
    const sinceStr = since.toISOString();

    const prevSince = new Date(since); prevSince.setDate(prevSince.getDate() - d);
    const prevStr = prevSince.toISOString();

    // Current period
    const [curr, prev, customers, products, refunds, discounts] = await Promise.all([
      db.execute({
        sql: `SELECT
          COUNT(*) as orders,
          COALESCE(SUM(total),0) as revenue,
          COALESCE(SUM(subtotal),0) as gross_sales,
          COALESCE(SUM(discount_amount),0) as total_discounts,
          COALESCE(SUM(shipping),0) as shipping_revenue,
          COALESCE(SUM(tax),0) as tax_collected,
          COALESCE(AVG(total),0) as aov
          FROM orders WHERE store_id=? AND status!='cancelled' AND created_at>=?`,
        args: [sid, sinceStr]
      }),
      db.execute({
        sql: `SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue, COALESCE(AVG(total),0) as aov
          FROM orders WHERE store_id=? AND status!='cancelled' AND created_at>=? AND created_at<?`,
        args: [sid, prevStr, sinceStr]
      }),
      db.execute({ sql: `SELECT COUNT(*) as total, COUNT(CASE WHEN orders_count>1 THEN 1 END) as returning FROM customers WHERE store_id=?`, args: [sid] }),
      db.execute({ sql: `SELECT COUNT(*) as active, COUNT(CASE WHEN quantity<=5 AND quantity>0 AND track_qty=1 THEN 1 END) as low_stock, COUNT(CASE WHEN quantity<=0 AND track_qty=1 THEN 1 END) as out_of_stock FROM products WHERE store_id=? AND status='active'`, args: [sid] }),
      db.execute({ sql: `SELECT COALESCE(SUM(amount),0) as total_refunded FROM refunds WHERE store_id=? AND created_at>=?`, args: [sid, sinceStr] }),
      db.execute({ sql: `SELECT COUNT(*) as total_codes, COALESCE(SUM(usage_count),0) as total_uses FROM discounts WHERE store_id=?`, args: [sid] }),
    ]);

    const c = curr.rows[0];
    const p = prev.rows[0];

    function pct(current, previous) {
      if (!previous || previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    }

    res.json({
      period_days: d,
      revenue: { value: c.revenue, prev: p.revenue, change_pct: pct(c.revenue, p.revenue) },
      orders: { value: c.orders, prev: p.orders, change_pct: pct(c.orders, p.orders) },
      aov: { value: c.aov, prev: p.aov, change_pct: pct(c.aov, p.aov) },
      gross_sales: c.gross_sales,
      net_sales: c.gross_sales - c.total_discounts - refunds.rows[0].total_refunded,
      total_discounts: c.total_discounts,
      shipping_revenue: c.shipping_revenue,
      tax_collected: c.tax_collected,
      total_refunded: refunds.rows[0].total_refunded,
      customers: customers.rows[0],
      products: products.rows[0],
      discounts: discounts.rows[0],
    });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Analytics failed.' }); }
});

// ── SALES OVER TIME ────────────────────────────────────────────────────────────
router.get('/sales-over-time', async (req, res) => {
  try {
    const db = getDB();
    const { days = 30, group = 'day' } = req.query;
    const d = parseInt(days);
    const since = new Date(); since.setDate(since.getDate() - d);

    const data = [];
    const step = d <= 30 ? 1 : d <= 90 ? 7 : 30;
    let cursor = new Date(since);

    while (cursor <= new Date()) {
      const start = cursor.toISOString().split('T')[0];
      const end = new Date(cursor); end.setDate(end.getDate() + step);
      const endStr = end.toISOString().split('T')[0];

      const result = await db.execute({
        sql: `SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue, COALESCE(SUM(subtotal),0) as gross
          FROM orders WHERE store_id=? AND status!='cancelled'
          AND date(created_at)>=? AND date(created_at)<?`,
        args: [req.storeId, start, endStr]
      });
      data.push({ date: start, ...result.rows[0] });
      cursor.setDate(cursor.getDate() + step);
    }

    res.json({ data });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});

// ── TOP PRODUCTS ───────────────────────────────────────────────────────────────
router.get('/top-products', async (req, res) => {
  try {
    const db = getDB();
    const { days = 30, limit = 10 } = req.query;
    const since = new Date(); since.setDate(since.getDate() - parseInt(days));

    const result = await db.execute({
      sql: `SELECT oi.title, oi.product_id,
        COUNT(*) as order_count,
        SUM(oi.quantity) as units_sold,
        SUM(oi.price * oi.quantity) as revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.store_id=? AND o.status!='cancelled' AND o.created_at>=?
        GROUP BY oi.title
        ORDER BY revenue DESC LIMIT ?`,
      args: [req.storeId, since.toISOString(), parseInt(limit)]
    });

    res.json({ products: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});

// ── TOP CUSTOMERS ──────────────────────────────────────────────────────────────
router.get('/top-customers', async (req, res) => {
  try {
    const db = getDB();
    const { days = 30, limit = 10 } = req.query;
    const since = new Date(); since.setDate(since.getDate() - parseInt(days));

    const result = await db.execute({
      sql: `SELECT c.id, c.first_name, c.last_name, c.email,
        COUNT(o.id) as order_count,
        SUM(o.total) as total_spent,
        MAX(o.created_at) as last_order_at
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        WHERE c.store_id=? AND o.status!='cancelled' AND o.created_at>=?
        GROUP BY c.id ORDER BY total_spent DESC LIMIT ?`,
      args: [req.storeId, since.toISOString(), parseInt(limit)]
    });

    res.json({ customers: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});

// ── DISCOUNT USAGE ─────────────────────────────────────────────────────────────
router.get('/discounts', async (req, res) => {
  try {
    const db = getDB();
    const { days = 30 } = req.query;
    const since = new Date(); since.setDate(since.getDate() - parseInt(days));

    const result = await db.execute({
      sql: `SELECT o.discount_code,
        COUNT(*) as orders_count,
        SUM(o.discount_amount) as total_savings,
        SUM(o.total) as total_revenue
        FROM orders o
        WHERE o.store_id=? AND o.discount_code IS NOT NULL AND o.status!='cancelled' AND o.created_at>=?
        GROUP BY o.discount_code ORDER BY orders_count DESC`,
      args: [req.storeId, since.toISOString()]
    });

    res.json({ discounts: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});

// ── TRAFFIC SOURCES ────────────────────────────────────────────────────────────
router.get('/sources', async (req, res) => {
  try {
    const db = getDB();
    const { days = 30 } = req.query;
    const since = new Date(); since.setDate(since.getDate() - parseInt(days));

    const result = await db.execute({
      sql: `SELECT
        COALESCE(utm_source, 'direct') as source,
        COALESCE(utm_medium, 'none') as medium,
        COUNT(*) as sessions,
        SUM(CASE WHEN event_type='order_placed' THEN 1 ELSE 0 END) as conversions
        FROM analytics_events
        WHERE store_id=? AND created_at>=?
        GROUP BY source, medium ORDER BY sessions DESC LIMIT 20`,
      args: [req.storeId, since.toISOString()]
    });

    res.json({ sources: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});

// ── INVENTORY REPORT ───────────────────────────────────────────────────────────
router.get('/inventory', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({
      sql: `SELECT id, title, sku, quantity, price,
        CASE WHEN quantity<=0 AND track_qty=1 THEN 'out_of_stock'
             WHEN quantity<=5 AND track_qty=1 THEN 'low_stock'
             ELSE 'in_stock' END as stock_status
        FROM products WHERE store_id=? AND status='active' ORDER BY quantity ASC`,
      args: [req.storeId]
    });
    res.json({ products: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});

// ── FINANCE SUMMARY ────────────────────────────────────────────────────────────
router.get('/finance', async (req, res) => {
  try {
    const db = getDB();
    const { days = 30 } = req.query;
    const since = new Date(); since.setDate(since.getDate() - parseInt(days));

    const [sales, refunds, bySource] = await Promise.all([
      db.execute({
        sql: `SELECT
          COALESCE(SUM(subtotal),0) as gross_sales,
          COALESCE(SUM(discount_amount),0) as discounts,
          COALESCE(SUM(shipping),0) as shipping,
          COALESCE(SUM(tax),0) as taxes,
          COALESCE(SUM(total),0) as total_sales,
          COUNT(*) as order_count
          FROM orders WHERE store_id=? AND status!='cancelled' AND created_at>=?`,
        args: [req.storeId, since.toISOString()]
      }),
      db.execute({
        sql: `SELECT COALESCE(SUM(amount),0) as total FROM refunds WHERE store_id=? AND created_at>=?`,
        args: [req.storeId, since.toISOString()]
      }),
      db.execute({
        sql: `SELECT source, COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
          FROM orders WHERE store_id=? AND status!='cancelled' AND created_at>=?
          GROUP BY source ORDER BY revenue DESC`,
        args: [req.storeId, since.toISOString()]
      }),
    ]);

    const s = sales.rows[0];
    const netSales = s.gross_sales - s.discounts - refunds.rows[0].total;

    res.json({
      gross_sales: s.gross_sales,
      discounts: s.discounts,
      returns: refunds.rows[0].total,
      net_sales: netSales,
      shipping: s.shipping,
      taxes: s.taxes,
      total_sales: s.total_sales,
      order_count: s.order_count,
      by_source: bySource.rows,
    });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});

module.exports = router;
