// routes/customers.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// LIST CUSTOMERS
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { search, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM customers WHERE store_id = ?';
    const params = [req.storeId];
    if (search) { query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    const result = await db.execute({ sql: query, args: params });
    res.json({ customers: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customers.' });
  }
});

// GET ONE CUSTOMER
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT * FROM customers WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
    const ordersResult = await db.execute({ sql: 'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', args: [req.params.id] });
    res.json({ ...result.rows[0], orders: ordersResult.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch customer.' });
  }
});

// CREATE CUSTOMER
router.post('/', async (req, res) => {
  try {
    const { email, firstName, lastName, phone, city, country, notes } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const db = getDB();
    const id = uuid();
    await db.execute({
      sql: 'INSERT INTO customers (id, store_id, email, first_name, last_name, phone, city, country, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, req.storeId, email.toLowerCase(), firstName || null, lastName || null, phone || null, city || null, country || null, notes || null]
    });
    const created = await db.execute({ sql: 'SELECT * FROM customers WHERE id = ?', args: [id] });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Customer with this email already exists.' });
    res.status(500).json({ error: 'Failed to create customer.' });
  }
});

// UPDATE CUSTOMER
router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { firstName, lastName, phone, city, country, notes } = req.body;
    await db.execute({
      sql: 'UPDATE customers SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), city = COALESCE(?, city), country = COALESCE(?, country), notes = COALESCE(?, notes) WHERE id = ? AND store_id = ?',
      args: [firstName || null, lastName || null, phone || null, city || null, country || null, notes || null, req.params.id, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM customers WHERE id = ?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update customer.' });
  }
});

// DELETE CUSTOMER
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM customers WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    res.json({ message: 'Customer deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete customer.' });
  }
});

module.exports = router;
