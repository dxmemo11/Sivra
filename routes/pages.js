// routes/pages.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

async function ensureTable(db) {
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS store_pages (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      content TEXT,
      seo_title TEXT,
      seo_description TEXT,
      status TEXT DEFAULT 'published',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, args: []
  });
}

router.get('/', async (req, res) => {
  try {
    const db = getDB();
    await ensureTable(db);
    const result = await db.execute({ sql: "SELECT * FROM store_pages WHERE store_id = ? ORDER BY created_at DESC", args: [req.storeId] });
    res.json({ pages: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch pages.' }); }
});

router.post('/', async (req, res) => {
  try {
    const db = getDB();
    await ensureTable(db);
    const { title, slug, content, seo_title, seo_description, status = 'published' } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    const id = uuid();
    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    await db.execute({
      sql: 'INSERT INTO store_pages (id, store_id, title, slug, content, seo_title, seo_description, status) VALUES (?,?,?,?,?,?,?,?)',
      args: [id, req.storeId, title, finalSlug, content||null, seo_title||null, seo_description||null, status]
    });
    const created = await db.execute({ sql: 'SELECT * FROM store_pages WHERE id = ?', args: [id] });
    res.status(201).json(created.rows[0]);
  } catch(err) { res.status(500).json({ error: 'Failed to create page.' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { title, slug, content, seo_title, seo_description, status } = req.body;
    await db.execute({
      sql: `UPDATE store_pages SET title=COALESCE(?,title), slug=COALESCE(?,slug), content=COALESCE(?,content),
            seo_title=COALESCE(?,seo_title), seo_description=COALESCE(?,seo_description),
            status=COALESCE(?,status), updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?`,
      args: [title||null, slug||null, content||null, seo_title||null, seo_description||null, status||null, req.params.id, req.storeId]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM store_pages WHERE id=?', args: [req.params.id] });
    res.json(updated.rows[0]);
  } catch(err) { res.status(500).json({ error: 'Failed to update page.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM store_pages WHERE id=? AND store_id=?', args: [req.params.id, req.storeId] });
    res.json({ message: 'Page deleted.' });
  } catch(err) { res.status(500).json({ error: 'Failed to delete page.' }); }
});

module.exports = router;
