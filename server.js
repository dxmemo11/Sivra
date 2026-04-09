// server.js
// Sivra backend — main entry point
// Run with: node server.js  OR  npm run dev (with nodemon)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── STARTUP CHECKS ─────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is required.');
  console.error('   Generate one with: openssl rand -hex 64');
  process.exit(1);
}

// ── SECURITY MIDDLEWARE ────────────────────────────────────────────────────
try {
  const helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
} catch(e) { console.warn('⚠️  helmet not installed — run: npm install helmet'); }

// Rate limiting
try {
  const rateLimit = require('express-rate-limit');
  app.use(rateLimit({ windowMs: 60*1000, max: 200, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests. Please try again in a moment.' } }));
  const authLimiter = rateLimit({ windowMs: 60*1000, max: 10,
    message: { error: 'Too many login attempts. Please wait a minute.' } });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/signup', authLimiter);
  const checkoutLimiter = rateLimit({ windowMs: 60*1000, max: 20,
    message: { error: 'Too many requests. Please wait a moment.' } });
  app.use('/api/checkout', checkoutLimiter);
} catch(e) { console.warn('⚠️  express-rate-limit not installed — run: npm install express-rate-limit'); }

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(s => s.trim()) : null;
app.use(cors({ origin: allowedOrigins || true, credentials: true }));

// ── BODY PARSING ───────────────────────────────────────────────────────────
app.use('/api/checkout/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── STATIC FILES ───────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ── FORCE HTTPS in production ──────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
  });
}

// ── ROUTES ──────────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/products',    require('./routes/products'));
app.use('/api/orders',      require('./routes/orders'));
app.use('/api/customers',   require('./routes/customers'));
app.use('/api/store',       require('./routes/store'));
app.use('/api/storefront',  require('./routes/storefront'));
app.use('/api/collections', require('./routes/collections'));
app.use('/api/discounts',   require('./routes/discounts'));
app.use('/api/analytics',   require('./routes/analytics'));
app.use('/api/pages',       require('./routes/pages'));
app.use('/api/menus',       require('./routes/menus'));
app.use('/api/blog',        require('./routes/blog'));
app.use('/api/abandoned',   require('./routes/abandoned'));

// Stripe checkout route
try { app.use('/api/checkout', require('./routes/checkout')); }
catch(e) { console.warn('⚠️  Stripe checkout route not loaded:', e.message); }

// ── EMAIL SEND TEST ─────────────────────────────────────────────────────────
app.get('/api/test-email', async (req, res) => {
  try {
    const email = require('./email');
    const result = await email.sendEmail({
      to: process.env.ADMIN_EMAIL || 'test@example.com',
      subject: 'Sivra test email', html: '<p>Email is working! 🎉</p>',
    });
    res.json({ result, provider: process.env.EMAIL_PROVIDER || 'none configured' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', platform: 'Sivra', time: new Date().toISOString() });
});

// ── SITEMAP.XML ─────────────────────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const { getDB } = require('./db/database');
    const db = getDB();
    const baseUrl = process.env.STORE_URL || req.protocol + '://' + req.get('host');
    const slug = process.env.STORE_SLUG || '';
    const storeBase = `${baseUrl}/sivra-storefront.html?store=${slug}`;
    const products = await db.execute({ sql: `SELECT id, title, updated_at FROM products WHERE status='active' LIMIT 1000`, args: [] });
    const collections = await db.execute({ sql: `SELECT id, name FROM collections WHERE status='active' LIMIT 200`, args: [] });
    const pages = await db.execute({ sql: `SELECT slug, updated_at FROM store_pages WHERE status='published'`, args: [] });
    const urls = [
      `  <url><loc>${storeBase}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      ...products.rows.map(p => `  <url><loc>${baseUrl}/sivra-product.html?id=${p.id}&amp;store=${slug}</loc><lastmod>${(p.updated_at||'').split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
      ...collections.rows.map(c => `  <url><loc>${baseUrl}/sivra-collection.html?store=${slug}&amp;id=${c.id}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
      ...pages.rows.map(p => `  <url><loc>${baseUrl}/sivra-policy.html?store=${slug}&amp;page=${p.slug}</loc><lastmod>${(p.updated_at||'').split('T')[0]}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`),
    ];
    res.set('Content-Type', 'application/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.join('') + '</urlset>');
  } catch(e) { res.status(500).send('Failed to generate sitemap'); }
});

app.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.STORE_URL || req.protocol + '://' + req.get('host');
  res.set('Content-Type', 'text/plain');
  res.send(['User-agent: *','Allow: /','Disallow: /sivra-dashboard.html','Disallow: /sivra-settings.html',
    'Disallow: /sivra-login.html','Disallow: /sivra-signup.html','Disallow: /api/',
    'Sitemap: ' + baseUrl + '/sitemap.xml'].join('\n'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : err.message
  });
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         SIVRA SERVER RUNNING         ║
  ║  Local:   http://localhost:${PORT}      ║
  ║  Mode:    ${(process.env.NODE_ENV || 'development').padEnd(10)}              ║
  ╚══════════════════════════════════════╝`);
});
