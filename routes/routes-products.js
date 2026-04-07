const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const auth = require('../middleware/auth');

// GET /api/products — list with search, filter, pagination
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { search = '', status = '', sort = 'created_at', dir = 'desc', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = [];
    let params = [];

    if (search) {
      where.push(`(name LIKE ? OR sku LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      where.push(`status = ?`);
      params.push(status);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const safeSort = ['created_at', 'name', 'price', 'inventory'].includes(sort) ? sort : 'created_at';
    const safeDir = dir === 'asc' ? 'ASC' : 'DESC';

    const [rows, countRow] = await Promise.all([
      db.execute({
        sql: `SELECT * FROM products ${whereClause} ORDER BY ${safeSort} ${safeDir} LIMIT ? OFFSET ?`,
        args: [...params, parseInt(limit), offset]
      }),
      db.execute({
        sql: `SELECT COUNT(*) as total FROM products ${whereClause}`,
        args: params
      })
    ]);

    res.json({
      products: rows.rows,
      total: countRow.rows[0].total,
      page: parseInt(page),
      pages: Math.ceil(countRow.rows[0].total / parseInt(limit))
    });
  } catch (err) {
    console.error('GET /products error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const row = await db.execute({ sql: `SELECT * FROM products WHERE id = ?`, args: [req.params.id] });
    if (!row.rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(row.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products — create
router.post('/', auth, async (req, res) => {
  try {
    const db = getDb();
    const { name, description, price, compare_price, sku, inventory, status = 'active', images = '[]', variants = '[]', tags = '' } = req.body;
    if (!name || price == null) return res.status(400).json({ error: 'name and price are required' });

    const id = `prod_${Date.now()}`;
    await db.execute({
      sql: `INSERT INTO products (id, name, description, price, compare_price, sku, inventory, status, images, variants, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      args: [id, name, description || '', parseFloat(price), compare_price ? parseFloat(compare_price) : null, sku || '', parseInt(inventory) || 0, status, JSON.stringify(images), JSON.stringify(variants), tags]
    });

    const created = await db.execute({ sql: `SELECT * FROM products WHERE id = ?`, args: [id] });
    res.status(201).json(created.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/products/:id — update
router.patch('/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    const allowed = ['name', 'description', 'price', 'compare_price', 'sku', 'inventory', 'status', 'images', 'variants', 'tags'];
    const updates = [];
    const vals = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = ?`);
        vals.push(typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    updates.push(`updated_at = datetime('now')`);
    vals.push(req.params.id);

    await db.execute({ sql: `UPDATE products SET ${updates.join(', ')} WHERE id = ?`, args: vals });
    const updated = await db.execute({ sql: `SELECT * FROM products WHERE id = ?`, args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/products/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = getDb();
    await db.execute({ sql: `DELETE FROM products WHERE id = ?`, args: [req.params.id] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
