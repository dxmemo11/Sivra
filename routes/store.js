// routes/store.js
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// DASHBOARD STATS
router.get('/stats', async (req, res) => {
  try {
    const db = getDB();
    const storeId = req.storeId;

    const ordersResult = await db.execute({ sql: "SELECT COUNT(*) as count, SUM(total) as revenue FROM orders WHERE store_id = ? AND status != 'cancelled'", args: [storeId] });
    const customersResult = await db.execute({ sql: 'SELECT COUNT(*) as count FROM customers WHERE store_id = ?', args: [storeId] });
    const productsResult = await db.execute({ sql: "SELECT COUNT(*) as count FROM products WHERE store_id = ? AND status = 'active'", args: [storeId] });

    const orders = ordersResult.rows[0];
    const customers = customersResult.rows[0];
    const products = productsResult.rows[0];

    // Last 7 days chart data
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayResult = await db.execute({
        sql: "SELECT COUNT(*) as orders, SUM(total) as revenue FROM orders WHERE store_id = ? AND date(created_at) = ? AND status != 'cancelled'",
        args: [storeId, dateStr]
      });
      chartData.push({ date: dateStr, orders: dayResult.rows[0].orders || 0, revenue: dayResult.rows[0].revenue || 0 });
    }

    res.json({
      revenue: orders.revenue || 0,
      orders: orders.count || 0,
      customers: customers.count || 0,
      products: products.count || 0,
      chartData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// GET STORE INFO
router.get('/info', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT * FROM stores WHERE id = ?', args: [req.storeId] });
    if (result.rows.length === 0) return res.status(404).json({ error: 'Store not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch store info.' });
  }
});

// UPDATE STORE INFO
router.patch('/info', async (req, res) => {
  try {
    const db = getDB();
    const { name, description, category, currency } = req.body;
    await db.execute({
      sql: 'UPDATE stores SET name = COALESCE(?, name), description = COALESCE(?, description), category = COALESCE(?, category), currency = COALESCE(?, currency), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [name || null, description || null, category || null, currency || null, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM stores WHERE id = ?', args: [req.storeId] });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update store.' });
  }
});

// SETTINGS alias (onboarding uses /api/store/settings)
router.patch('/settings', async (req, res) => {
  try {
    const db = getDB();
    const { name, description, category, currency, storeName } = req.body;
    const finalName = name || storeName || null;
    await db.execute({
      sql: 'UPDATE stores SET name = COALESCE(?, name), description = COALESCE(?, description), category = COALESCE(?, category), currency = COALESCE(?, currency), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [finalName, description || null, category || null, currency || null, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM stores WHERE id = ?', args: [req.storeId] });
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

module.exports = router;
