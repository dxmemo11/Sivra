// routes/discounts.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// LIST
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS discounts (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        code TEXT NOT NULL,
        type TEXT DEFAULT 'percent',
        value REAL DEFAULT 0,
        method TEXT DEFAULT 'code',
        min_order REAL,
        usage_limit INTEGER,
        used_count INTEGER DEFAULT 0,
        once_per_customer INTEGER DEFAULT 0,
        starts_at TEXT,
        ends_at TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, args: []
    });
    const result = await db.execute({ sql: 'SELECT * FROM discounts WHERE store_id = ? ORDER BY created_at DESC', args: [req.storeId] });
    res.json({ discounts: result.rows });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch discounts.' });
  }
});

// CREATE
router.post('/', async (req, res) => {
  try {
    const db = getDB();
    const { code, type = 'percentage', value = 0, method = 'code', min_order, usage_limit, once_per_customer, starts_at, ends_at } = req.body;
    if (!code) return res.status(400).json({ error: 'Discount code is required.' });
    const id = uuid();
    await db.execute({
      sql: `INSERT INTO discounts (id, store_id, code, type, value, method, min_order_amount, usage_limit, once_per_customer, starts_at, ends_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      args: [id, req.storeId, code.toUpperCase(), type, parseFloat(value)||0, method, min_order||null, usage_limit||null, once_per_customer?1:0, starts_at||null, ends_at||null]
    });
    const created = await db.execute({ sql: 'SELECT * FROM discounts WHERE id = ?', args: [id] });
    res.status(201).json(created.rows[0]);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create discount.' });
  }
});

// VALIDATE (for checkout)
router.post('/validate', async (req, res) => {
  try {
    const db = getDB();
    const { code, subtotal = 0, customerId } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required.' });
    const result = await db.execute({
      sql: `SELECT * FROM discounts WHERE store_id = ? AND UPPER(code) = UPPER(?) AND method = 'code'`,
      args: [req.storeId, code]
    });
    if (!result.rows.length) return res.status(404).json({ error: 'Discount code not found.' });
    const disc = result.rows[0];
    const now = new Date();
    if (disc.starts_at && new Date(disc.starts_at) > now) return res.status(400).json({ error: 'Discount has not started yet.' });
    if (disc.ends_at && new Date(disc.ends_at) < now) return res.status(400).json({ error: 'Discount has expired.' });
    if (disc.usage_limit && disc.usage_count >= disc.usage_limit) return res.status(400).json({ error: 'Discount usage limit reached.' });
    if (disc.min_order_amount && parseFloat(subtotal) < disc.min_order_amount) return res.status(400).json({ error: `Minimum order of $${disc.min_order_amount.toFixed(2)} required.` });
    let savings = 0;
    if (disc.type === 'percentage') savings = parseFloat(subtotal) * (disc.value / 100);
    if (disc.type === 'fixed') savings = Math.min(disc.value, parseFloat(subtotal));
    if (disc.type === 'free_shipping') savings = 0; // handled at checkout
    res.json({ valid: true, discount: disc, savings: parseFloat(savings.toFixed(2)) });
  } catch(err) {
    res.status(500).json({ error: 'Failed to validate discount.' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM discounts WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    res.json({ message: 'Discount deleted.' });
  } catch(err) {
    res.status(500).json({ error: 'Failed to delete discount.' });
  }
});


// UPDATE
router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { code, title, type, value, min_order_amount, usage_limit, once_per_customer, starts_at, ends_at, status } = req.body;
    await db.execute({
      sql: `UPDATE discounts SET
        code=COALESCE(?,code), title=COALESCE(?,title), type=COALESCE(?,type),
        value=COALESCE(?,value), min_order_amount=COALESCE(?,min_order_amount),
        usage_limit=COALESCE(?,usage_limit), once_per_customer=COALESCE(?,once_per_customer),
        starts_at=COALESCE(?,starts_at), ends_at=COALESCE(?,ends_at),
        status=COALESCE(?,status)
        WHERE id=? AND store_id=?`,
      args: [code||null, title||null, type||null,
        value!==undefined?parseFloat(value)||0:null,
        min_order_amount!==undefined?parseFloat(min_order_amount)||null:null,
        usage_limit!==undefined?parseInt(usage_limit)||null:null,
        once_per_customer!==undefined?(once_per_customer?1:0):null,
        starts_at!==undefined?starts_at||null:null,
        ends_at!==undefined?ends_at||null:null,
        status||null, req.params.id, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM discounts WHERE id=?', args:[req.params.id] });
    res.json({ discount: updated.rows[0] });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to update discount.' }); }
});

module.exports = router;
