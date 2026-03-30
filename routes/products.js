// routes/products.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// LIST PRODUCTS
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { status, category, search, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM products WHERE store_id = ?';
    const params = [req.storeId];
    if (status)   { query += ' AND status = ?';    params.push(status); }
    if (category) { query += ' AND category = ?';  params.push(category); }
    if (search)   { query += ' AND title LIKE ?';  params.push(`%${search}%`); }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    const result = await db.execute({ sql: query, args: params });
    const products = result.rows.map(p => ({ ...p, images: JSON.parse(p.images || '[]') }));
    res.json({ products, total: products.length, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

// GET ONE
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT * FROM products WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    const p = result.rows[0];
    res.json({ ...p, images: JSON.parse(p.images || '[]') });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product.' });
  }
});

// CREATE
router.post('/', async (req, res) => {
  try {
    const { title, description, price, comparePrice, sku, quantity = 0, trackQty = true, weight = 0, category, status = 'active', images = [] } = req.body;
    if (!title) return res.status(400).json({ error: 'Product title is required.' });
    if (price === undefined || price === '') return res.status(400).json({ error: 'Price is required.' });
    const db = getDB();
    const id = uuid();
    await db.execute({
      sql: 'INSERT INTO products (id, store_id, title, description, price, compare_price, sku, quantity, track_qty, weight, category, status, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, req.storeId, title, description || null, parseFloat(price) || 0, comparePrice ? parseFloat(comparePrice) : null, sku || null, parseInt(quantity) || 0, trackQty ? 1 : 0, parseFloat(weight) || 0, category || null, status, JSON.stringify(images)]
    });
    const created = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] });
    const p = created.rows[0];
    res.status(201).json({ ...p, images: JSON.parse(p.images || '[]') });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

// UPDATE
router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const existing = await db.execute({ sql: 'SELECT * FROM products WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    const { title, description, price, comparePrice, sku, quantity, trackQty, weight, category, status, images } = req.body;
    await db.execute({
      sql: `UPDATE products SET title = COALESCE(?, title), description = COALESCE(?, description), price = COALESCE(?, price), compare_price = COALESCE(?, compare_price), sku = COALESCE(?, sku), quantity = COALESCE(?, quantity), track_qty = COALESCE(?, track_qty), weight = COALESCE(?, weight), category = COALESCE(?, category), status = COALESCE(?, status), images = COALESCE(?, images), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`,
      args: [title || null, description || null, price !== undefined ? parseFloat(price) : null, comparePrice !== undefined ? (comparePrice ? parseFloat(comparePrice) : null) : null, sku || null, quantity !== undefined ? parseInt(quantity) : null, trackQty !== undefined ? (trackQty ? 1 : 0) : null, weight !== undefined ? parseFloat(weight) : null, category || null, status || null, images !== undefined ? JSON.stringify(images) : null, req.params.id, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [req.params.id] });
    const p = updated.rows[0];
    res.json({ ...p, images: JSON.parse(p.images || '[]') });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM products WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    res.json({ message: 'Product deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

// BULK STATUS
router.patch('/bulk/status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids?.length || !status) return res.status(400).json({ error: 'ids and status required.' });
    const db = getDB();
    for (const id of ids) {
      await db.execute({ sql: 'UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?', args: [status, id, req.storeId] });
    }
    res.json({ message: `${ids.length} products updated.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update products.' });
  }
});

module.exports = router;
