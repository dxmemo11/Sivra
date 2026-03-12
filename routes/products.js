// routes/products.js
// Create, read, update, delete products for a store

const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// All product routes require the merchant to be logged in
router.use(requireAuth);


// ── LIST PRODUCTS ──────────────────────────────────────────────────────────
// GET /api/products
// Query params: status, category, search, page, limit
router.get('/', (req, res) => {
  const db = getDB();
  const { status, category, search, page = 1, limit = 50 } = req.query;

  let query = 'SELECT * FROM products WHERE store_id = ?';
  const params = [req.storeId];

  if (status)   { query += ' AND status = ?';              params.push(status); }
  if (category) { query += ' AND category = ?';            params.push(category); }
  if (search)   { query += ' AND title LIKE ?';            params.push(`%${search}%`); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const products = db.prepare(query).all(...params);

  // Parse the images JSON field
  const parsed = products.map(p => ({ ...p, images: JSON.parse(p.images || '[]') }));

  // Get total count for pagination
  let countQ = 'SELECT COUNT(*) as total FROM products WHERE store_id = ?';
  const countP = [req.storeId];
  if (status)   { countQ += ' AND status = ?';   countP.push(status); }
  if (category) { countQ += ' AND category = ?'; countP.push(category); }
  if (search)   { countQ += ' AND title LIKE ?'; countP.push(`%${search}%`); }
  const { total } = db.prepare(countQ).get(...countP);

  res.json({ products: parsed, total, page: parseInt(page), limit: parseInt(limit) });
});


// ── GET ONE PRODUCT ────────────────────────────────────────────────────────
// GET /api/products/:id
router.get('/:id', (req, res) => {
  const db = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?')
    .get(req.params.id, req.storeId);

  if (!product) return res.status(404).json({ error: 'Product not found.' });

  res.json({ ...product, images: JSON.parse(product.images || '[]') });
});


// ── CREATE PRODUCT ─────────────────────────────────────────────────────────
// POST /api/products
// Body: { title, description, price, comparePrice, sku, quantity, trackQty, weight, category, status, images }
router.post('/', (req, res) => {
  const {
    title, description, price, comparePrice,
    sku, quantity = 0, trackQty = true,
    weight = 0, category, status = 'active',
    images = []
  } = req.body;

  if (!title) return res.status(400).json({ error: 'Product title is required.' });
  if (price === undefined || price === '') return res.status(400).json({ error: 'Price is required.' });

  const db = getDB();
  const id = uuid();

  db.prepare(`
    INSERT INTO products
      (id, store_id, title, description, price, compare_price, sku, quantity, track_qty, weight, category, status, images)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.storeId,
    title, description || null,
    parseFloat(price), comparePrice ? parseFloat(comparePrice) : null,
    sku || null, parseInt(quantity), trackQty ? 1 : 0,
    parseFloat(weight), category || null,
    status, JSON.stringify(images)
  );

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.status(201).json({ ...product, images: JSON.parse(product.images) });
});


// ── UPDATE PRODUCT ─────────────────────────────────────────────────────────
// PATCH /api/products/:id
router.patch('/:id', (req, res) => {
  const db = getDB();

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?')
    .get(req.params.id, req.storeId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const {
    title, description, price, comparePrice,
    sku, quantity, trackQty, weight,
    category, status, images
  } = req.body;

  db.prepare(`
    UPDATE products SET
      title         = COALESCE(?, title),
      description   = COALESCE(?, description),
      price         = COALESCE(?, price),
      compare_price = ?,
      sku           = COALESCE(?, sku),
      quantity      = COALESCE(?, quantity),
      track_qty     = COALESCE(?, track_qty),
      weight        = COALESCE(?, weight),
      category      = COALESCE(?, category),
      status        = COALESCE(?, status),
      images        = COALESCE(?, images),
      updated_at    = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `).run(
    title || null, description || null,
    price !== undefined ? parseFloat(price) : null,
    comparePrice !== undefined ? (comparePrice ? parseFloat(comparePrice) : null) : product.compare_price,
    sku || null,
    quantity !== undefined ? parseInt(quantity) : null,
    trackQty !== undefined ? (trackQty ? 1 : 0) : null,
    weight !== undefined ? parseFloat(weight) : null,
    category || null, status || null,
    images !== undefined ? JSON.stringify(images) : null,
    req.params.id, req.storeId
  );

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({ ...updated, images: JSON.parse(updated.images) });
});


// ── DELETE PRODUCT ─────────────────────────────────────────────────────────
// DELETE /api/products/:id
router.delete('/:id', (req, res) => {
  const db = getDB();
  const result = db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?')
    .run(req.params.id, req.storeId);

  if (result.changes === 0) return res.status(404).json({ error: 'Product not found.' });
  res.json({ message: 'Product deleted.' });
});


// ── BULK STATUS UPDATE ─────────────────────────────────────────────────────
// PATCH /api/products/bulk/status
// Body: { ids: [...], status: 'active' | 'draft' | 'archived' }
router.patch('/bulk/status', (req, res) => {
  const { ids, status } = req.body;
  if (!ids?.length || !status) return res.status(400).json({ error: 'ids and status required.' });

  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND store_id = ?`)
    .run(status, ...ids, req.storeId);

  res.json({ message: `${ids.length} products updated.` });
});

module.exports = router;
