// routes/orders.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// LIST ORDERS
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { status, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM orders WHERE store_id = ?';
    const params = [req.storeId];
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    const result = await db.execute({ sql: query, args: params });
    res.json({ orders: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// GET ONE ORDER
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const orderResult = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const order = orderResult.rows[0];
    const itemsResult = await db.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [order.id] });
    res.json({ ...order, items: itemsResult.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// CREATE ORDER
router.post('/', async (req, res) => {
  try {
    const { customerId, items = [], subtotal = 0, shipping = 0, tax = 0, total = 0, shippingName, shippingAddr, shippingCity, shippingCountry, notes } = req.body;
    if (!items.length) return res.status(400).json({ error: 'Order must have at least one item.' });
    const db = getDB();
    const countResult = await db.execute({ sql: 'SELECT COUNT(*) as cnt FROM orders WHERE store_id = ?', args: [req.storeId] });
    const orderNumber = (countResult.rows[0].cnt || 0) + 1;
    const id = uuid();
    await db.execute({
      sql: 'INSERT INTO orders (id, store_id, customer_id, order_number, subtotal, shipping, tax, total, shipping_name, shipping_addr, shipping_city, shipping_country, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, req.storeId, customerId || null, orderNumber, subtotal, shipping, tax, total, shippingName || null, shippingAddr || null, shippingCity || null, shippingCountry || null, notes || null]
    });
    for (const item of items) {
      await db.execute({
        sql: 'INSERT INTO order_items (id, order_id, product_id, title, price, quantity) VALUES (?, ?, ?, ?, ?, ?)',
        args: [uuid(), id, item.productId || null, item.title, item.price, item.quantity || 1]
      });
    }
    const created = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [id] });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

// UPDATE ORDER STATUS
router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { status, paymentStatus, payment_status, fulfillment_status, fulfillmentStatus } = req.body;
    const pay = payment_status || paymentStatus || null;
    const fulfill = fulfillment_status || fulfillmentStatus || null;
    await db.execute({
      sql: 'UPDATE orders SET status = COALESCE(?, status), payment_status = COALESCE(?, payment_status), fulfillment_status = COALESCE(?, fulfillment_status), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?',
      args: [status || null, pay, fulfill, req.params.id, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order.' });
  }
});

// CANCEL ORDER
router.post('/:id/cancel', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({
      sql: "UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?",
      args: [req.params.id, req.storeId]
    });
    res.json({ message: 'Order cancelled.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel order.' });
  }
});

module.exports = router;
