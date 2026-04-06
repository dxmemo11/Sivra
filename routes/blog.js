// routes/blog.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

async function ensureTable(db) {
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS blog_posts (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      title TEXT NOT NULL, slug TEXT NOT NULL,
      author TEXT, content TEXT, excerpt TEXT,
      image_url TEXT, tags TEXT,
      seo_title TEXT, seo_description TEXT,
      status TEXT DEFAULT 'draft',
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, args: []
  });
}

router.get('/', async (req, res) => {
  try {
    const db = getDB(); await ensureTable(db);
    const { status } = req.query;
    let sql = 'SELECT * FROM blog_posts WHERE store_id=?';
    const args = [req.storeId];
    if (status) { sql += ' AND status=?'; args.push(status); }
    sql += ' ORDER BY created_at DESC';
    const result = await db.execute({ sql, args });
    res.json({ posts: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch posts.' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDB(); await ensureTable(db);
    const result = await db.execute({ sql:'SELECT * FROM blog_posts WHERE id=? AND store_id=?', args:[req.params.id, req.storeId] });
    if (!result.rows.length) return res.status(404).json({ error: 'Post not found.' });
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: 'Failed to fetch post.' }); }
});

router.post('/', async (req, res) => {
  try {
    const db = getDB(); await ensureTable(db);
    const { title, slug, author, content, excerpt, image_url, tags, seo_title, seo_description, status='draft' } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required.' });
    const id = uuid();
    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    await db.execute({
      sql: `INSERT INTO blog_posts (id,store_id,title,slug,author,content,excerpt,image_url,tags,seo_title,seo_description,status,published_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id,req.storeId,title,finalSlug,author||null,content||null,excerpt||null,image_url||null,tags||null,seo_title||null,seo_description||null,status,status==='published'?new Date().toISOString():null]
    });
    const created = await db.execute({ sql:'SELECT * FROM blog_posts WHERE id=?', args:[id] });
    res.status(201).json({ post: created.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to create post.' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { title, slug, author, content, excerpt, image_url, tags, seo_title, seo_description, status } = req.body;
    await db.execute({
      sql: `UPDATE blog_posts SET
        title=COALESCE(?,title), slug=COALESCE(?,slug), author=COALESCE(?,author),
        content=COALESCE(?,content), excerpt=COALESCE(?,excerpt), image_url=COALESCE(?,image_url),
        tags=COALESCE(?,tags), seo_title=COALESCE(?,seo_title), seo_description=COALESCE(?,seo_description),
        status=COALESCE(?,status),
        published_at=CASE WHEN ?='published' AND published_at IS NULL THEN CURRENT_TIMESTAMP ELSE published_at END,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?`,
      args: [title||null,slug||null,author||null,content||null,excerpt||null,image_url||null,tags||null,seo_title||null,seo_description||null,status||null,status||null,req.params.id,req.storeId]
    });
    const updated = await db.execute({ sql:'SELECT * FROM blog_posts WHERE id=?', args:[req.params.id] });
    res.json({ post: updated.rows[0] });
  } catch(err) { res.status(500).json({ error: 'Failed to update post.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql:'DELETE FROM blog_posts WHERE id=? AND store_id=?', args:[req.params.id, req.storeId] });
    res.json({ message: 'Post deleted.' });
  } catch(err) { res.status(500).json({ error: 'Failed to delete post.' }); }
});

module.exports = router;
