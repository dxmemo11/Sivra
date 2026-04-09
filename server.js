// server.js — Sivra production-grade backend
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
if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ FATAL: JWT_SECRET is too short. Use at least 32 characters.');
  process.exit(1);
}

// ── SECURITY MIDDLEWARE ────────────────────────────────────────────────────
try {
  const helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: false,     // Allow inline scripts (vanilla HTML pages)
    crossOriginEmbedderPolicy: false, // Allow embedded images
    hsts: { maxAge: 31536000, includeSubDomains: true }, // 1 year HSTS
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },  // Prevent clickjacking
    xXssProtection: true,
  }));
} catch(e) { console.warn('⚠️  helmet not installed — run: npm install helmet'); }

// ── RATE LIMITING ──────────────────────────────────────────────────────────
try {
  const rateLimit = require('express-rate-limit');

  // Global: 200 req/min per IP
  app.use(rateLimit({
    windowMs: 60 * 1000, max: 200,
    standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    message: { error: 'Too many requests. Please try again in a moment.' }
  }));

  // Auth: 10 req/min (brute force protection)
  const authLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10,
    keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    message: { error: 'Too many login attempts. Please wait a minute.' }
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/signup', authLimiter);

  // Checkout: 20 req/min
  const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000, max: 20,
    keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    message: { error: 'Too many checkout requests. Please wait a moment.' }
  });
  app.use('/api/storefront/*/checkout', checkoutLimiter);

  // Analytics tracking: 60 req/min per IP (lightweight but bounded)
  const trackLimiter = rateLimit({
    windowMs: 60 * 1000, max: 60,
    keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    message: { ok: true } // Never block the user, just stop recording
  });
  app.use('/api/track', trackLimiter);

} catch(e) { console.warn('⚠️  express-rate-limit not installed — run: npm install express-rate-limit'); }

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(s => s.trim()) : null;
app.use(cors({ origin: allowedOrigins || true, credentials: true }));

// ── BODY PARSING ───────────────────────────────────────────────────────────
// Stripe webhook needs raw body BEFORE json parser
app.use('/api/checkout/webhook', express.raw({ type: 'application/json' }));
// JSON with strict size limits
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── INPUT SANITIZATION ─────────────────────────────────────────────────────
// Strip dangerous HTML from all string inputs to prevent XSS
function sanitizeValue(val) {
  if (typeof val !== 'string') return val;
  // Remove <script> tags and event handlers
  return val
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeObject(val);
    } else {
      clean[key] = sanitizeValue(val);
    }
  }
  return clean;
}

// Apply to all POST/PATCH/PUT requests (except raw webhook)
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body = sanitizeObject(req.body);
  }
  next();
});

// ── STATIC FILES ───────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, // Cache static files in prod
  etag: true,
}));

// ── FORCE HTTPS in production ──────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
  });
}

// ── REQUEST LOGGING (production) ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > 2000 || res.statusCode >= 500) {
        console.log(`[${res.statusCode}] ${req.method} ${req.originalUrl} ${duration}ms`);
      }
    });
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

// Real-time analytics tracker (public + admin endpoints)
try { app.use('/api/track', require('./routes/analytics-tracker')); }
catch(e) { console.warn('⚠️  analytics-tracker not loaded:', e.message); }

// Stripe checkout route (optional — only loads if stripe package installed)
try { app.use('/api/checkout', require('./routes/checkout')); }
catch(e) { console.warn('⚠️  Stripe checkout route not loaded:', e.message); }

// ── EMAIL TEST ─────────────────────────────────────────────────────────────
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

// ── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { getDB } = require('./db/database');
    const db = getDB();
    await db.execute({ sql: 'SELECT 1', args: [] });
    res.json({
      status: 'ok', platform: 'Sivra',
      time: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: 'connected',
    });
  } catch(e) {
    res.status(503).json({ status: 'degraded', db: 'disconnected', error: e.message });
  }
});

// ── SITEMAP.XML ─────────────────────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const { getDB } = require('./db/database');
    const db = getDB();
    const baseUrl = process.env.STORE_URL || req.protocol + '://' + req.get('host');
    const slug = process.env.STORE_SLUG || '';
    const storeBase = `${baseUrl}/sivra-storefront.html?store=${slug}`;
    const products = await db.execute({ sql: `SELECT id, title FROM products WHERE status='active' LIMIT 1000`, args: [] });
    const collections = await db.execute({ sql: `SELECT id, name FROM collections WHERE status='active' LIMIT 200`, args: [] });
    const pages = await db.execute({ sql: `SELECT slug FROM store_pages WHERE status='published'`, args: [] });
    const urls = [
      `  <url><loc>${storeBase}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      ...products.rows.map(p => `  <url><loc>${baseUrl}/sivra-product.html?id=${p.id}&amp;store=${slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
      ...collections.rows.map(c => `  <url><loc>${baseUrl}/sivra-collection.html?store=${slug}&amp;id=${c.id}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
      ...pages.rows.map(p => `  <url><loc>${baseUrl}/sivra-policy.html?store=${slug}&amp;page=${p.slug}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`),
    ];
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache 1 hour
    res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.join('') + '</urlset>');
  } catch(e) { res.status(500).send('Failed to generate sitemap'); }
});

app.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.STORE_URL || req.protocol + '://' + req.get('host');
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', 'public, max-age=86400'); // Cache 1 day
  res.send([
    'User-agent: *', 'Allow: /',
    'Disallow: /sivra-dashboard.html', 'Disallow: /sivra-settings.html',
    'Disallow: /sivra-login.html', 'Disallow: /sivra-signup.html',
    'Disallow: /sivra-orders.html', 'Disallow: /sivra-products.html',
    'Disallow: /sivra-customers.html', 'Disallow: /sivra-analytics.html',
    'Disallow: /sivra-edit-product.html', 'Disallow: /sivra-add-product.html',
    'Disallow: /api/',
    'Sitemap: ' + baseUrl + '/sitemap.xml'
  ].join('\n'));
});

// ── CATCH-ALL ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/sivra-login.html');
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

// ── ERROR HANDLER (never expose internals in production) ────────────────────
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : err.message
  });
});

// ── START SERVER ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         SIVRA SERVER RUNNING         ║
  ║  Local:   http://localhost:${PORT}      ║
  ║  Mode:    ${(process.env.NODE_ENV || 'development').padEnd(24)}║
  ║  Security: helmet + rate-limit       ║
  ║  Tracking: analytics-tracker         ║
  ╚══════════════════════════════════════╝`);
});
