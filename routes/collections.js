// routes/collections.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

async function ensureTable(db) {
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'active',
      sort_order TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, args: []
  });
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS product_collections (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, args: []
  });
}

router.get('/', async (req, res) => {
  try {
    const db = getDB();
    await ensureTable(db);
    const result = await db.execute({ sql: 'SELECT * FROM collections WHERE store_id = ? ORDER BY created_at DESC', args: [req.storeId] });
    res.json({ collections: result.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to fetch collections.' }); }
});

router.post('/', async (req, res) => {
  try {
    const db = getDB();
    await ensureTable(db);
    const { name, description, image_url, status = 'active' } = req.body;
    if (!name) return res.status(400).json({ error: 'Collection name is required.' });
    const id = uuid();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    await db.execute({
      sql: 'INSERT INTO collections (id, store_id, name, slug, description, image_url, status) VALUES (?,?,?,?,?,?,?)',
      args: [id, req.storeId, name, slug, description||null, image_url||null, status]
    });
    const created = await db.execute({ sql: 'SELECT * FROM collections WHERE id = ?', args: [id] });
    res.status(201).json(created.rows[0]);
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to create collection.' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    await ensureTable(db);
    const result = await db.execute({ sql: 'SELECT * FROM collections WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!result.rows.length) return res.status(404).json({ error: 'Collection not found.' });
    const products = await db.execute({
      sql: 'SELECT p.* FROM products p JOIN product_collections pc ON p.id = pc.product_id WHERE pc.collection_id = ? ORDER BY pc.position',
      args: [req.params.id]
    });
    res.json({ ...result.rows[0], products: products.rows.map(p => ({ ...p, images: JSON.parse(p.images||'[]') })) });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch collection.' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { name, description, image, image_url, status, sort_order, seo_title, seo_description, slug } = req.body;
    await db.execute({
      sql: `UPDATE collections SET
        name=COALESCE(?,name), description=COALESCE(?,description),
        image=COALESCE(?,image), status=COALESCE(?,status),
        sort_order=COALESCE(?,sort_order), seo_title=COALESCE(?,seo_title),
        seo_description=COALESCE(?,seo_description), slug=COALESCE(?,slug),
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?`,
      args: [name||null, description||null, image||image_url||null, status||null,
        sort_order||null, seo_title||null, seo_description||null, slug||null,
        req.params.id, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM collections WHERE id=?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch(err) { res.status(500).json({ error: 'Failed to update collection.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM collections WHERE id=? AND store_id=?', args: [req.params.id, req.storeId] });
    await db.execute({ sql: 'DELETE FROM product_collections WHERE collection_id=?', args: [req.params.id] });
    res.json({ message: 'Collection deleted.' });
  } catch(err) { res.status(500).json({ error: 'Failed to delete collection.' }); }
});

// Add product to collection
router.post('/:id/products', async (req, res) => {
  try {
    const db = getDB();
    await ensureTable(db);
    const { productId } = req.body;
    const existing = await db.execute({ sql: 'SELECT id FROM product_collections WHERE collection_id=? AND product_id=?', args: [req.params.id, productId] });
    if (existing.rows.length) return res.json({ message: 'Already in collection.' });
    await db.execute({ sql: 'INSERT INTO product_collections (id, collection_id, product_id) VALUES (?,?,?)', args: [uuid(), req.params.id, productId] });
    res.json({ message: 'Product added to collection.' });
  } catch(err) { res.status(500).json({ error: 'Failed to add product.' }); }
});

// Remove product from collection
router.delete('/:id/products/:productId', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM product_collections WHERE collection_id=? AND product_id=?', args: [req.params.id, req.params.productId] });
    res.json({ message: 'Product removed.' });
  } catch(err) { res.status(500).json({ error: 'Failed to remove product.' }); }
});

module.exports = router;
