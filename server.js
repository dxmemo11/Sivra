// server.js
// Sivra backend — main entry point
// Run with: node server.js  OR  npm run dev (with nodemon)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──────────────────────────────────────────────────────────────

// Allow requests from your frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

// Parse JSON request bodies
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve uploaded images as static files
// e.g. GET /uploads/product-abc123.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the frontend HTML files in production
// (put your HTML files in a /public folder)
app.use(express.static(path.join(__dirname, 'public')));


// ── ROUTES ──────────────────────────────────────────────────────────────────

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/products',   require('./routes/products'));
app.use('/api/orders',     require('./routes/orders'));
app.use('/api/customers',  require('./routes/customers'));
app.use('/api/store',      require('./routes/store'));
app.use('/api/storefront', require('./routes/storefront')); // public — no auth

// Health check — useful for server monitoring
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', platform: 'Sivra', time: new Date().toISOString() });
});

// Catch-all: send index.html for any unknown route (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});


// ── ERROR HANDLER ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err.message
  });
});


// ── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         SIVRA SERVER RUNNING         ║
  ║                                      ║
  ║  Local:   http://localhost:${PORT}      ║
  ║  Mode:    ${(process.env.NODE_ENV || 'development').padEnd(10)}              ║
  ╚══════════════════════════════════════╝
  `);
});
