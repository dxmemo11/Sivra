// ─── db.js ────────────────────────────────────────────────────────────────────
// Save this file as db.js in your project root.
// Usage: const { getDb } = require('./db');
//
// const { createClient } = require('@libsql/client');
// let db;
// function getDb() {
//   if (!db) {
//     db = createClient({
//       url: process.env.TURSO_URL,
//       authToken: process.env.TURSO_AUTH_TOKEN,
//     });
//   }
//   return db;
// }
// module.exports = { getDb };

// ─── middleware/auth.js ───────────────────────────────────────────────────────
// Save as middleware/auth.js
//
// const jwt = require('jsonwebtoken');
// module.exports = (req, res, next) => {
//   const auth = req.headers.authorization;
//   if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
//   try {
//     req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
//     next();
//   } catch { res.status(401).json({ error: 'Invalid token' }); }
// };

// ─── server.js ────────────────────────────────────────────────────────────────
// This is your main entry point. Add/replace your existing server.js with this.

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());

// Stripe webhook needs raw body — mount BEFORE express.json()
const checkoutRouter = require('./routes/checkout');
app.use('/api/checkout/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/products',  require('./routes/products'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/checkout',  checkoutRouter);

// ── Settings routes (inline — simple key/value store) ─────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const { getDb } = require('./db');
    const db = getDb();
    const rows = await db.execute({ sql: `SELECT key, value FROM settings`, args: [] });
    const settings = {};
    rows.rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { getDb } = require('./db');
    const db = getDb();
    for (const [key, value] of Object.entries(req.body)) {
      await db.execute({ sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, args: [key, String(value)] });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auth: login ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const { email, password } = req.body;
    // TODO: replace with real user lookup from DB
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@sivra.com';
    const ADMIN_PASS  = process.env.ADMIN_PASSWORD || 'changeme';
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASS) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ email, role: 'admin' }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });
    res.json({ token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── SPA fallback (serve store for unknown routes) ─────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'sivra-store.html'));
});

app.listen(PORT, () => console.log(`Sivra running on port ${PORT}`));
module.exports = app;
