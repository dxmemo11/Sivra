// routes/menus.js — Navigation menus, stored in DB
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

async function ensureMenusTable(db) {
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS menus (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      title TEXT,
      items TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store_id, handle)
    )`, args: []
  });
}

router.get('/:handle', async (req, res) => {
  try {
    const db = getDB();
    await ensureMenusTable(db);
    const result = await db.execute({
      sql: 'SELECT * FROM menus WHERE store_id=? AND handle=?',
      args: [req.storeId, req.params.handle]
    });
    if (!result.rows.length) {
      return res.json({ handle: req.params.handle, items: [] });
    }
    const menu = result.rows[0];
    res.json({ ...menu, items: JSON.parse(menu.items || '[]') });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to fetch menu.' }); }
});

router.patch('/:handle', async (req, res) => {
  try {
    const db = getDB();
    await ensureMenusTable(db);
    const { items = [], title } = req.body;
    const itemsJson = JSON.stringify(items);
    const { v4: uuid } = require('uuid');
    // Upsert
    await db.execute({
      sql: `INSERT INTO menus (id, store_id, handle, title, items)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(store_id, handle) DO UPDATE SET
            items=excluded.items,
            title=COALESCE(excluded.title, title),
            updated_at=CURRENT_TIMESTAMP`,
      args: [uuid(), req.storeId, req.params.handle, title || req.params.handle, itemsJson]
    });
    res.json({ handle: req.params.handle, items });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to save menu.' }); }
});

// Also support PUT for backwards compat
router.put('/:handle', async (req, res) => {
  req.method = 'PATCH';
  router.handle(req, res);
});

module.exports = router;
