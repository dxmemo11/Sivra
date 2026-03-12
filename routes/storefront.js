// routes/storefront.js
// Public routes — no login needed
// These power the actual shop customers see at yourdomain.com/shop/:slug

const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');


// ── GET STORE INFO ─────────────────────────────────────────────────────────
// GET /api/storefront/:slug
router.get('/:slug', (req, res) => {
  const db = getDB();
  const store = db.prepare("SELECT id, name, slug, description, category, currency, logo_url FROM stores WHERE slug = ? AND status = 'active'")
    .get(req.params.slug);
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  res.json(store);
});


// ── LIST PRODUCTS (public) ─────────────────────────────────────────────────
// GET /api/storefront/:slug/products
// Query: category, search, page, limit, sort
router.get('/:slug/products', (req, res) => {
  const db = getDB();
  const store = db.prepare("SELECT id FROM stores WHERE slug = ? AND status = 'active'").get(req.params.slug);
  if (!store) return res.status(404).json({ error: 'Store not found.' });

  const { category, search, page = 1, limit = 24, sort = 'newest' } = req.query;

  const sortMap = {
    newest:     'created_at DESC',
    oldest:     'created_at ASC',
    price_asc:  'price ASC',
    price_desc: 'price DESC',
  };
  const orderBy = sortMap[sort] || 'created_at DESC';

  let query = `SELECT id, title, description, price, compare_price, images, category FROM products WHERE store_id = ? AND status = 'active'`;
  const params = [store.id];

  if (category) { query += ' AND category = ?'; params.push(category); }
  if (search)   { query += ' AND title LIKE ?'; params.push(`%${search}%`); }

  query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const products = db.prepare(query).all(...params).map(p => ({
    ...p, images: JSON.parse(p.images || '[]')
  }));

  const { total } = db.prepare("SELECT COUNT(*) as total FROM products WHERE store_id = ? AND status = 'active'").get(store.id);
  res.json({ products, total });
});


// ── GET ONE PRODUCT (public) ───────────────────────────────────────────────
// GET /api/storefront/:slug/products/:productId
router.get('/:slug/products/:productId', (req, res) => {
  const db = getDB();
  const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(req.params.slug);
  if (!store) return res.status(404).json({ error: 'Store not found.' });

  const product = db.prepare("SELECT * FROM products WHERE id = ? AND store_id = ? AND status = 'active'")
    .get(req.params.productId, store.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  res.json({ ...product, images: JSON.parse(product.images || '[]') });
});


// ── PLACE ORDER (checkout) ─────────────────────────────────────────────────
// POST /api/storefront/:slug/checkout
// Body: { customerEmail, firstName, lastName, phone, items: [{productId, quantity}], shippingAddress }
router.post('/:slug/checkout', (req, res) => {
  const db = getDB();
  const store = db.prepare("SELECT * FROM stores WHERE slug = ? AND status = 'active'").get(req.params.slug);
  if (!store) return res.status(404).json({ error: 'Store not found.' });

  const { customerEmail, firstName, lastName, phone, items, shippingAddress = {} } = req.body;

  if (!customerEmail) return res.status(400).json({ error: 'Email is required.' });
  if (!items?.length) return res.status(400).json({ error: 'Your cart is empty.' });

  const { v4: uuid } = require('uuid');

  // Validate & price items
  let subtotal = 0;
  const resolved = [];

  for (const item of items) {
    const product = db.prepare("SELECT * FROM products WHERE id = ? AND store_id = ? AND status = 'active'")
      .get(item.productId, store.id);
    if (!product) return res.status(400).json({ error: `Product not found.` });

    if (product.track_qty && product.quantity < item.quantity) {
      return res.status(400).json({ error: `${product.title} only has ${product.quantity} left in stock.` });
    }

    const qty = parseInt(item.quantity) || 1;
    subtotal += product.price * qty;
    resolved.push({ product, qty });
  }

  const shipping = subtotal >= 75 ? 0 : 4.99; // free shipping over $75
  const tax = subtotal * 0.08;
  const total = subtotal + shipping + tax;

  // Get or create customer
  let customer = db.prepare('SELECT * FROM customers WHERE store_id = ? AND email = ?')
    .get(store.id, customerEmail.toLowerCase());

  if (!customer) {
    const customerId = uuid();
    db.prepare('INSERT INTO customers (id, store_id, email, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?, ?)')
      .run(customerId, store.id, customerEmail.toLowerCase(), firstName || null, lastName || null, phone || null);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  }

  const { maxNum } = db.prepare('SELECT MAX(order_number) as maxNum FROM orders WHERE store_id = ?').get(store.id);
  const orderNumber = (maxNum || 1000) + 1;
  const orderId = uuid();

  const placeOrder = db.transaction(() => {
    db.prepare(`
      INSERT INTO orders (id, store_id, customer_id, order_number, status, payment_status, subtotal, shipping, tax, total, shipping_name, shipping_addr, shipping_city, shipping_country)
      VALUES (?, ?, ?, ?, 'pending', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, store.id, customer.id, orderNumber, subtotal, shipping, tax, total,
      shippingAddress.name || `${firstName || ''} ${lastName || ''}`.trim() || null,
      shippingAddress.address || null, shippingAddress.city || null, shippingAddress.country || null);

    for (const { product, qty } of resolved) {
      db.prepare('INSERT INTO order_items (id, order_id, product_id, title, price, quantity) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuid(), orderId, product.id, product.title, product.price, qty);

      if (product.track_qty) {
        db.prepare('UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(qty, product.id);
      }
    }
  });

  placeOrder();

  res.status(201).json({
    message: 'Order placed successfully!',
    orderNumber,
    orderId,
    total,
    estimatedDelivery: '3–5 business days'
  });
});

module.exports = router;
