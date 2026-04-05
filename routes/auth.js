// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');

// ── SIGN UP ────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password, storeName } = req.body;

    if (!firstName || !email || !password || !storeName) {
      return res.status(400).json({ error: 'Please fill in all required fields.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const db = getDB();

    // Generate store slug and check if taken
    let slug = storeName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    const slugExists = await db.execute({ sql: 'SELECT id FROM stores WHERE slug = ?', args: [slug] });
    if (slugExists.rows.length > 0) {
      return res.status(409).json({ error: 'That store name is already taken. Please choose a different name.' });
    }

    // Check if merchant already exists
    const existing = await db.execute({ sql: 'SELECT * FROM merchants WHERE email = ?', args: [email.toLowerCase()] });

    let merchantId;
    if (existing.rows.length > 0) {
      // Verify password matches before adding store
      const valid = await bcrypt.compare(password, existing.rows[0].password);
      if (!valid) {
        return res.status(401).json({ error: 'That email is already registered. Use your correct password to add a new store.' });
      }
      merchantId = existing.rows[0].id;
    } else {
      // New merchant
      merchantId = uuid();
      const hashedPassword = await bcrypt.hash(password, 12);
      await db.execute({
        sql: 'INSERT INTO merchants (id, email, password, first_name, last_name) VALUES (?, ?, ?, ?, ?)',
        args: [merchantId, email.toLowerCase(), hashedPassword, firstName, lastName || '']
      });
    }

    const storeId = uuid();
    await db.execute({
      sql: 'INSERT INTO stores (id, merchant_id, name, slug) VALUES (?, ?, ?, ?)',
      args: [storeId, merchantId, storeName, slug]
    });

    const token = jwt.sign(
      { merchantId, storeId },
      process.env.JWT_SECRET || 'sivra_dev_secret',
      { expiresIn: '30d' }
    );

    res.status(201).json({
      message: 'Store created successfully!',
      token,
      merchant: { id: merchantId, firstName, lastName, email: email.toLowerCase() },
      store: { id: storeId, name: storeName, slug }
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});



router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const db = getDB();

    const result = await db.execute({
      sql: 'SELECT * FROM merchants WHERE email = ?',
      args: [email.toLowerCase()]
    });

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const merchant = result.rows[0];

    const valid = await bcrypt.compare(password, merchant.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (merchant.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended.' });
    }

    const storeResult = await db.execute({
      sql: 'SELECT * FROM stores WHERE merchant_id = ? LIMIT 1',
      args: [merchant.id]
    });
    const store = storeResult.rows[0] || null;

    const token = jwt.sign(
      { merchantId: merchant.id, storeId: store?.id },
      process.env.JWT_SECRET || 'sivra_dev_secret',
      { expiresIn: '30d' }
    );

    res.json({
      token,
      merchant: {
        id: merchant.id,
        firstName: merchant.first_name,
        lastName: merchant.last_name,
        email: merchant.email,
        plan: merchant.plan
      },
      store: store ? { id: store.id, name: store.name, slug: store.slug } : null
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});


// ── GET CURRENT USER ────────────────────────────────────────────────────────
const { requireAuth } = require('../middleware/auth');

router.get('/me', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const merchantResult = await db.execute({
      sql: 'SELECT id, email, first_name, last_name, plan, status, created_at FROM merchants WHERE id = ?',
      args: [req.merchantId]
    });
    const storeResult = await db.execute({
      sql: 'SELECT * FROM stores WHERE id = ?',
      args: [req.storeId]
    });

    if (merchantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    res.json({
      merchant: merchantResult.rows[0],
      store: storeResult.rows[0] || null
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});


// ── CHANGE PASSWORD ─────────────────────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const db = getDB();
    const result = await db.execute({
      sql: 'SELECT * FROM merchants WHERE id = ?',
      args: [req.merchantId]
    });
    const merchant = result.rows[0];

    const valid = await bcrypt.compare(currentPassword, merchant.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await db.execute({
      sql: 'UPDATE merchants SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [hashed, req.merchantId]
    });

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
