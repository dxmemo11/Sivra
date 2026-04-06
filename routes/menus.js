// routes/menus.js
const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/:handle', async (req, res) => {
  try {
    // For now return from store settings / localStorage fallback
    res.json({ handle: req.params.handle, items: [] });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch menu.' }); }
});

router.put('/:handle', async (req, res) => {
  try {
    const { items } = req.body;
    res.json({ handle: req.params.handle, items: items || [] });
  } catch(err) { res.status(500).json({ error: 'Failed to save menu.' }); }
});

module.exports = router;
