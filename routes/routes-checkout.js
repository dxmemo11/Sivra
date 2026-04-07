// ─── routes/checkout.js ────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// POST /api/checkout/create-intent
// Called by storefront to create a Stripe PaymentIntent
router.post('/create-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd', metadata = {} } = req.body;
    if (!amount || amount < 50) return res.status(400).json({ error: 'Invalid amount' });

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount),   // amount in cents
      currency,
      automatic_payment_methods: { enabled: true },
      metadata
    });

    res.json({ client_secret: intent.client_secret, payment_intent_id: intent.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/checkout/webhook — Stripe webhook (set in Railway env)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    // Order is created by storefront POST /api/orders after payment confirmation
    console.log('PaymentIntent succeeded:', event.data.object.id);
  }

  res.json({ received: true });
});

module.exports = router;

/* ─── schema.sql ─────────────────────────────────────────────────────────────
   Run this once against your Turso DB to create all tables.
   turso db shell <your-db-name> < schema.sql
──────────────────────────────────────────────────────────────────────────── */
/*
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  compare_price REAL,
  sku TEXT DEFAULT '',
  inventory INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  images TEXT DEFAULT '[]',
  variants TEXT DEFAULT '[]',
  tags TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  status TEXT DEFAULT 'pending',
  subtotal REAL DEFAULT 0,
  shipping REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'stripe',
  channel TEXT DEFAULT 'Online',
  stripe_payment_intent TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT,
  variant TEXT DEFAULT '',
  quantity INTEGER DEFAULT 1,
  unit_price REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('store_name', 'My Store'),
  ('store_email', ''),
  ('store_currency', 'usd'),
  ('stripe_publishable_key', ''),
  ('shipping_flat_rate', '5.99'),
  ('free_shipping_threshold', '50');
*/
