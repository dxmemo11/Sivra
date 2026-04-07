// ─── routes/customers.js ───────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const db = getDb();
    const { search = '', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = search ? `WHERE name LIKE ? OR email LIKE ?` : '';
    const params = search ? [`%${search}%`, `%${search}%`] : [];

    const [rows, countRow, statsRow] = await Promise.all([
      db.execute({ sql: `SELECT c.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total),0) as lifetime_value FROM customers c LEFT JOIN orders o ON o.customer_id = c.id ${where} GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, args: [...params, parseInt(limit), offset] }),
      db.execute({ sql: `SELECT COUNT(*) as total FROM customers ${where}`, args: params }),
      db.execute({ sql: `SELECT COUNT(*) as total FROM customers` })
    ]);
    res.json({ customers: rows.rows, total: countRow.rows[0].total, page: parseInt(page), pages: Math.ceil(countRow.rows[0].total / parseInt(limit)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const [cust, orders] = await Promise.all([
      db.execute({ sql: `SELECT * FROM customers WHERE id = ?`, args: [req.params.id] }),
      db.execute({ sql: `SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC`, args: [req.params.id] })
    ]);
    if (!cust.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ...cust.rows[0], orders: orders.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upsert customer by email (called at checkout)
router.post('/upsert', async (req, res) => {
  try {
    const db = getDb();
    const { name, email, phone, address } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const existing = await db.execute({ sql: `SELECT id FROM customers WHERE email = ?`, args: [email] });
    if (existing.rows.length) {
      await db.execute({ sql: `UPDATE customers SET name=?, phone=?, address=?, updated_at=datetime('now') WHERE email=?`, args: [name, phone || '', address || '', email] });
      return res.json({ id: existing.rows[0].id });
    }
    const id = `cust_${Date.now()}`;
    await db.execute({ sql: `INSERT INTO customers (id, name, email, phone, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`, args: [id, name, email, phone || '', address || ''] });
    res.status(201).json({ id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
