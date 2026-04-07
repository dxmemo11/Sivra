const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const auth = require('../middleware/auth');

// GET /api/orders
router.get('/', auth, async (req, res) => {
  try {
    const db = getDb();
    const { search = '', status = '', sort = 'created_at', dir = 'desc', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = [];
    const params = [];

    if (search) {
      where.push(`(o.id LIKE ? OR c.name LIKE ? OR c.email LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) { where.push(`o.status = ?`); params.push(status); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const safeSort = ['created_at', 'total', 'status'].includes(sort) ? `o.${sort}` : 'o.created_at';
    const safeDir = dir === 'asc' ? 'ASC' : 'DESC';

    const [rows, countRow] = await Promise.all([
      db.execute({
        sql: `SELECT o.*, c.name as customer_name, c.email as customer_email
              FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
              ${whereClause} ORDER BY ${safeSort} ${safeDir} LIMIT ? OFFSET ?`,
        args: [...params, parseInt(limit), offset]
      }),
      db.execute({ sql: `SELECT COUNT(*) as total FROM orders o LEFT JOIN customers c ON o.customer_id = c.id ${whereClause}`, args: params })
    ]);

    res.json({ orders: rows.rows, total: countRow.rows[0].total, page: parseInt(page), pages: Math.ceil(countRow.rows[0].total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id — with line items
router.get('/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const [orderRes, itemsRes] = await Promise.all([
      db.execute({
        sql: `SELECT o.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address
              FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.id = ?`,
        args: [req.params.id]
      }),
      db.execute({ sql: `SELECT oi.*, p.name as product_name, p.images as product_images FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`, args: [req.params.id] })
    ]);
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Order not found' });
    res.json({ ...orderRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders — create (called from storefront checkout)
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { customer_id, items, subtotal, shipping = 0, discount = 0, total, payment_method, channel = 'Online', stripe_payment_intent } = req.body;
    if (!items?.length || !total) return res.status(400).json({ error: 'items and total required' });

    const id = `ord_${Date.now()}`;
    await db.execute({
      sql: `INSERT INTO orders (id, customer_id, status, subtotal, shipping, discount, total, payment_method, channel, stripe_payment_intent, created_at, updated_at)
            VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      args: [id, customer_id || null, parseFloat(subtotal), parseFloat(shipping), parseFloat(discount), parseFloat(total), payment_method || 'stripe', channel, stripe_payment_intent || null]
    });

    for (const item of items) {
      await db.execute({
        sql: `INSERT INTO order_items (order_id, product_id, variant, quantity, unit_price) VALUES (?, ?, ?, ?, ?)`,
        args: [id, item.product_id, item.variant || '', parseInt(item.quantity), parseFloat(item.unit_price)]
      });
      await db.execute({ sql: `UPDATE products SET inventory = MAX(0, inventory - ?) WHERE id = ?`, args: [parseInt(item.quantity), item.product_id] });
    }

    res.status(201).json({ id, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const db = getDb();
    const { status } = req.body;
    const valid = ['pending', 'paid', 'shipped', 'delivered', 'refunded', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await db.execute({ sql: `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, args: [status, req.params.id] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
