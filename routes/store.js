// routes/store.js
// Store settings + dashboard analytics

const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);


// ── DASHBOARD STATS ────────────────────────────────────────────────────────
// GET /api/store/dashboard
// Returns all the numbers shown on the dashboard home page
router.get('/dashboard', (req, res) => {
  const db = getDB();
  const storeId = req.storeId;

  // Revenue & orders — all time
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(total), 0) as total_revenue
    FROM orders WHERE store_id = ? AND payment_status = 'paid'
  `).get(storeId);

  // Revenue this month
  const monthRevenue = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as revenue
    FROM orders
    WHERE store_id = ? AND payment_status = 'paid'
    AND created_at >= date('now', 'start of month')
  `).get(storeId);

  // Revenue last month (for % change)
  const lastMonthRevenue = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as revenue
    FROM orders
    WHERE store_id = ? AND payment_status = 'paid'
    AND created_at >= date('now', 'start of month', '-1 month')
    AND created_at < date('now', 'start of month')
  `).get(storeId);

  // Customers
  const { customer_count } = db.prepare('SELECT COUNT(*) as customer_count FROM customers WHERE store_id = ?').get(storeId);

  // Pending orders (need attention)
  const { pending } = db.prepare("SELECT COUNT(*) as pending FROM orders WHERE store_id = ? AND status = 'pending'").get(storeId);

  // Low stock products (< 5)
  const { low_stock } = db.prepare("SELECT COUNT(*) as low_stock FROM products WHERE store_id = ? AND track_qty = 1 AND quantity < 5 AND status = 'active'").get(storeId);

  // Revenue last 7 days (for sparkline chart)
  const last7Days = db.prepare(`
    SELECT
      date(created_at) as day,
      COALESCE(SUM(total), 0) as revenue,
      COUNT(*) as orders
    FROM orders
    WHERE store_id = ? AND payment_status = 'paid'
    AND created_at >= date('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all(storeId);

  // Recent 5 orders
  const recentOrders = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.payment_status, o.total, o.created_at,
           c.first_name, c.last_name, c.email as customer_email
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.store_id = ?
    ORDER BY o.created_at DESC
    LIMIT 5
  `).all(storeId);

  // Top 5 products by revenue
  const topProducts = db.prepare(`
    SELECT p.id, p.title, p.price, p.images,
           SUM(oi.quantity) as units_sold,
           SUM(oi.price * oi.quantity) as revenue
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN products p ON oi.product_id = p.id
    WHERE o.store_id = ? AND o.payment_status = 'paid'
    GROUP BY p.id
    ORDER BY revenue DESC
    LIMIT 5
  `).all(storeId);

  const revenueChange = lastMonthRevenue.revenue > 0
    ? ((monthRevenue.revenue - lastMonthRevenue.revenue) / lastMonthRevenue.revenue * 100).toFixed(1)
    : null;

  res.json({
    revenue: {
      total: totals.total_revenue,
      thisMonth: monthRevenue.revenue,
      changePercent: revenueChange,
      last7Days
    },
    orders: {
      total: totals.total_orders,
      pending
    },
    customers: {
      total: customer_count
    },
    products: {
      lowStock: low_stock
    },
    recentOrders,
    topProducts: topProducts.map(p => ({ ...p, images: JSON.parse(p.images || '[]') }))
  });
});


// ── GET STORE SETTINGS ─────────────────────────────────────────────────────
// GET /api/store/settings
router.get('/settings', (req, res) => {
  const db = getDB();
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.storeId);
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  res.json(store);
});


// ── UPDATE STORE SETTINGS ──────────────────────────────────────────────────
// PATCH /api/store/settings
router.patch('/settings', (req, res) => {
  const db = getDB();
  const { name, description, category, currency, logoUrl } = req.body;

  db.prepare(`
    UPDATE stores SET
      name        = COALESCE(?, name),
      description = COALESCE(?, description),
      category    = COALESCE(?, category),
      currency    = COALESCE(?, currency),
      logo_url    = COALESCE(?, logo_url),
      updated_at  = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name || null, description || null, category || null, currency || null, logoUrl || null, req.storeId);

  const updated = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.storeId);
  res.json(updated);
});

module.exports = router;
