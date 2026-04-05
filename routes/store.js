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
    res.json({ revenue: orders.revenue || 0, orders: orders.count || 0, customers: customers.count || 0, products: products.count || 0, chartData });
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
    const store = result.rows[0];
    // Parse shipping zones if stored as JSON string
    if (store.shipping_zones && typeof store.shipping_zones === 'string') {
      try { store.shipping_zones = JSON.parse(store.shipping_zones); } catch(e) {}
    }
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch store info.' });
  }
});

// UPDATE STORE INFO + SHIPPING
router.patch('/info', async (req, res) => {
  try {
    const db = getDB();
    const { name, description, category, currency, shipping_zones } = req.body;
    await db.execute({
      sql: 'UPDATE stores SET name = COALESCE(?, name), description = COALESCE(?, description), category = COALESCE(?, category), currency = COALESCE(?, currency), shipping_zones = COALESCE(?, shipping_zones), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [name || null, description || null, category || null, currency || null, shipping_zones ? JSON.stringify(shipping_zones) : null, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM stores WHERE id = ?', args: [req.storeId] });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update store.' });
  }
});

// GET SHIPPING SETTINGS
router.get('/shipping', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT shipping_zones FROM stores WHERE id = ?', args: [req.storeId] });
    const raw = result.rows[0]?.shipping_zones;
    let zones = [];
    try { zones = raw ? JSON.parse(raw) : []; } catch(e) {}
    if (!zones.length) {
      // Default zones
      zones = [
        { id: 1, name: 'Domestic', countries: 'Australia', rate: 9.95, free_over: 100 },
        { id: 2, name: 'International', countries: 'Rest of World', rate: 24.95, free_over: null }
      ];
    }
    res.json({ zones });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch shipping.' });
  }
});

// UPDATE SHIPPING SETTINGS
router.patch('/shipping', async (req, res) => {
  try {
    const db = getDB();
    const { zones } = req.body;
    if (!zones) return res.status(400).json({ error: 'zones required' });
    await db.execute({
      sql: 'UPDATE stores SET shipping_zones = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [JSON.stringify(zones), req.storeId]
    });
    res.json({ zones, message: 'Shipping updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update shipping.' });
  }
});

// SETTINGS alias
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
