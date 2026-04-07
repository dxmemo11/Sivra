// routes/abandoned.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

async function ensureTable(db) {
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS abandoned_checkouts (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      email TEXT,
      cart TEXT DEFAULT '[]',
      total REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      recovery_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, args: []
  });
}

// GET all abandoned checkouts (admin)
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    await ensureTable(db);
    // Abandoned = no order placed within 1 hour of checkout start
    const result = await db.execute({
      sql: `SELECT * FROM abandoned_checkouts
            WHERE store_id=?
            AND created_at < datetime('now', '-1 hour')
            ORDER BY created_at DESC
            LIMIT 100`,
      args: [req.storeId]
    });
    const checkouts = result.rows.map(row => ({
      ...row,
      cart: JSON.parse(row.cart || '[]'),
    }));
    res.json({ checkouts });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch abandoned checkouts.' });
  }
});

module.exports = router;
