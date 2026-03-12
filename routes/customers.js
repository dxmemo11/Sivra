// routes/customers.js

const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);


// ── LIST CUSTOMERS ─────────────────────────────────────────────────────────
// GET /api/customers
router.get('/', (req, res) => {
  const db = getDB();
  const { search, page = 1, limit = 50 } = req.query;

  let query = `
    SELECT c.*,
      COUNT(o.id) as order_count,
      COALESCE(SUM(o.total), 0) as total_spent,
      MAX(o.created_at) as last_order_date
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE c.store_id = ?
  `;
  const params = [req.storeId];

  if (search) {
    query += ' AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  query += ' GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const customers = db.prepare(query).all(...params);

  // Compute segment label
  const withSegment = customers.map(c => ({
    ...c,
    segment: c.order_count === 0 ? 'inactive'
            : c.order_count === 1 ? 'new'
            : c.total_spent > 400 ? 'vip'
            : 'regular'
  }));

  const { total } = db.prepare('SELECT COUNT(*) as total FROM customers WHERE store_id = ?').get(req.storeId);
  res.json({ customers: withSegment, total });
});


// ── GET ONE CUSTOMER ───────────────────────────────────────────────────────
// GET /api/customers/:id
router.get('/:id', (req, res) => {
  const db = getDB();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND store_id = ?')
    .get(req.params.id, req.storeId);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const orders = db.prepare(`
    SELECT id, order_number, status, payment_status, total, created_at
    FROM orders WHERE customer_id = ? ORDER BY created_at DESC
  `).all(customer.id);

  const stats = db.prepare(`
    SELECT COUNT(*) as order_count, COALESCE(SUM(total),0) as total_spent
    FROM orders WHERE customer_id = ?
  `).get(customer.id);

  res.json({ ...customer, orders, ...stats });
});


// ── CREATE CUSTOMER ────────────────────────────────────────────────────────
// POST /api/customers
router.post('/', (req, res) => {
  const { email, firstName, lastName, phone, city, country, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const db = getDB();
  const exists = db.prepare('SELECT id FROM customers WHERE store_id = ? AND email = ?')
    .get(req.storeId, email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'A customer with this email already exists.' });

  const id = uuid();
  db.prepare(`
    INSERT INTO customers (id, store_id, email, first_name, last_name, phone, city, country, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.storeId, email.toLowerCase(), firstName || null, lastName || null, phone || null, city || null, country || null, notes || null);

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  res.status(201).json(customer);
});


// ── UPDATE CUSTOMER ────────────────────────────────────────────────────────
// PATCH /api/customers/:id
router.patch('/:id', (req, res) => {
  const db = getDB();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND store_id = ?')
    .get(req.params.id, req.storeId);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const { firstName, lastName, phone, city, country, notes } = req.body;

  db.prepare(`
    UPDATE customers SET
      first_name = COALESCE(?, first_name),
      last_name  = COALESCE(?, last_name),
      phone      = COALESCE(?, phone),
      city       = COALESCE(?, city),
      country    = COALESCE(?, country),
      notes      = COALESCE(?, notes)
    WHERE id = ? AND store_id = ?
  `).run(firstName || null, lastName || null, phone || null, city || null, country || null, notes || null, req.params.id, req.storeId);

  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(updated);
});


// ── DELETE CUSTOMER ────────────────────────────────────────────────────────
// DELETE /api/customers/:id
router.delete('/:id', (req, res) => {
  const db = getDB();
  const result = db.prepare('DELETE FROM customers WHERE id = ? AND store_id = ?')
    .run(req.params.id, req.storeId);
  if (result.changes === 0) return res.status(404).json({ error: 'Customer not found.' });
  res.json({ message: 'Customer deleted.' });
});

module.exports = router;
