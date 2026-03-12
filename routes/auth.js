// routes/auth.js
// Handles merchant signup, login, and logout

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');

// ── SIGN UP ────────────────────────────────────────────────────────────────
// POST /api/auth/signup
// Body: { firstName, lastName, email, password, storeName }
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, storeName } = req.body;

  if (!firstName || !email || !password || !storeName) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const db = getDB();

  // Check if email already registered
  const existing = db.prepare('SELECT id FROM merchants WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  // Hash the password (never store plain text!)
  const hashedPassword = await bcrypt.hash(password, 12);

  // Generate a URL-safe store slug from the store name
  // "Sarah's Boutique" → "sarahs-boutique"
  let slug = storeName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  // Make slug unique if it already exists
  const slugExists = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
  if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

  const merchantId = uuid();
  const storeId = uuid();

  // Use a transaction so both inserts succeed or both fail
  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO merchants (id, email, password, first_name, last_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(merchantId, email.toLowerCase(), hashedPassword, firstName, lastName);

    db.prepare(`
      INSERT INTO stores (id, merchant_id, name, slug)
      VALUES (?, ?, ?, ?)
    `).run(storeId, merchantId, storeName, slug);
  });

  create();

  // Issue a JWT so they're logged in immediately after signup
  const token = jwt.sign(
    { merchantId, storeId },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.status(201).json({
    message: 'Account created successfully!',
    token,
    merchant: { id: merchantId, firstName, lastName, email: email.toLowerCase() },
    store: { id: storeId, name: storeName, slug }
  });
});


// ── LOG IN ─────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Body: { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = getDB();

  // Find merchant
  const merchant = db.prepare('SELECT * FROM merchants WHERE email = ?').get(email.toLowerCase());
  if (!merchant) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // Check password
  const valid = await bcrypt.compare(password, merchant.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (merchant.status === 'suspended') {
    return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });
  }

  // Get their store
  const store = db.prepare('SELECT * FROM stores WHERE merchant_id = ? LIMIT 1').get(merchant.id);

  // Issue JWT
  const token = jwt.sign(
    { merchantId: merchant.id, storeId: store?.id },
    process.env.JWT_SECRET,
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
});


// ── GET CURRENT USER ────────────────────────────────────────────────────────
// GET /api/auth/me  (requires token)
const { requireAuth } = require('../middleware/auth');

router.get('/me', requireAuth, (req, res) => {
  const db = getDB();
  const merchant = db.prepare('SELECT id, email, first_name, last_name, plan, status, created_at FROM merchants WHERE id = ?').get(req.merchantId);
  const store = db.prepare('SELECT * FROM stores WHERE merchant_id = ? LIMIT 1').get(req.merchantId);

  if (!merchant) return res.status(404).json({ error: 'Account not found.' });

  res.json({ merchant, store });
});


// ── CHANGE PASSWORD ─────────────────────────────────────────────────────────
// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const db = getDB();
  const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.merchantId);

  const valid = await bcrypt.compare(currentPassword, merchant.password);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE merchants SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hashed, req.merchantId);

  res.json({ message: 'Password updated successfully.' });
});

module.exports = router;
