// routes/storefront.js — public routes, no auth needed
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');

// GET STORE INFO
router.get('/:slug', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: "SELECT id, name, slug, description, category, currency, logo_url FROM stores WHERE slug = ? AND status = 'active'", args: [req.params.slug] });
    if (result.rows.length === 0) return res.status(404).json({ error: 'Store not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch store.' });
  }
});

// LIST PRODUCTS (public)
router.get('/:slug/products', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: "SELECT id FROM stores WHERE slug = ? AND status = 'active'", args: [req.params.slug] });
    if (storeResult.rows.length === 0) return res.status(404).json({ error: 'Store not found.' });
    const store = storeResult.rows[0];
    const { category, search, page = 1, limit = 24 } = req.query;
    let query = "SELECT id, title, description, price, compare_price, images, category FROM products WHERE store_id = ? AND status = 'active'";
    const params = [store.id];
    if (category) { query += ' AND category = ?'; params.push(category); }
    if (search)   { query += ' AND title LIKE ?'; params.push(`%${search}%`); }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    const result = await db.execute({ sql: query, args: params });
    const products = result.rows.map(p => ({ ...p, images: JSON.parse(p.images || '[]') }));
    res.json({ products, total: products.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

// GET ONE PRODUCT (public)
router.get('/:slug/products/:productId', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: 'SELECT id FROM stores WHERE slug = ?', args: [req.params.slug] });
    if (storeResult.rows.length === 0) return res.status(404).json({ error: 'Store not found.' });
    const store = storeResult.rows[0];
    const result = await db.execute({ sql: "SELECT * FROM products WHERE id = ? AND store_id = ? AND status = 'active'", args: [req.params.productId, store.id] });
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    const p = result.rows[0];
    res.json({ ...p, images: JSON.parse(p.images || '[]') });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product.' });
  }
});

// CHECKOUT
router.post('/:slug/checkout', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: "SELECT * FROM stores WHERE slug = ? AND status = 'active'", args: [req.params.slug] });
    if (storeResult.rows.length === 0) return res.status(404).json({ error: 'Store not found.' });
    const store = storeResult.rows[0];
    const { customerEmail, firstName, lastName, phone, items, shippingAddress = {} } = req.body;
    if (!customerEmail) return res.status(400).json({ error: 'Email is required.' });
    if (!items?.length) return res.status(400).json({ error: 'Your cart is empty.' });

    let subtotal = 0;
    const resolved = [];
    for (const item of items) {
      const pResult = await db.execute({ sql: "SELECT * FROM products WHERE id = ? AND store_id = ? AND status = 'active'", args: [item.productId, store.id] });
      if (pResult.rows.length === 0) return res.status(400).json({ error: 'Product not found.' });
      const product = pResult.rows[0];
      if (product.track_qty && product.quantity < item.quantity) {
        return res.status(400).json({ error: `${product.title} only has ${product.quantity} left in stock.` });
      }
      const qty = parseInt(item.quantity) || 1;
      subtotal += product.price * qty;
      resolved.push({ product, qty });
    }

    // Get shipping from store zones
    let shipping = 0; // default free
    try {
      const zonesRaw = store.shipping_zones;
      const zones = zonesRaw ? (typeof zonesRaw === 'string' ? JSON.parse(zonesRaw) : zonesRaw) : [];
      if (zones && zones.length > 0) {
        const zone = zones[0];
        const rate = parseFloat(zone.rate) || 0;
        const freeOver = zone.free_over ? parseFloat(zone.free_over) : null;
        shipping = (freeOver !== null && subtotal >= freeOver) ? 0 : rate;
      }
    } catch(e) { shipping = 0; }
    const tax = subtotal * 0.08;
    const total = subtotal + shipping + tax;

    // Get or create customer
    let customerId;
    const custResult = await db.execute({ sql: 'SELECT id FROM customers WHERE store_id = ? AND email = ?', args: [store.id, customerEmail.toLowerCase()] });
    if (custResult.rows.length > 0) {
      customerId = custResult.rows[0].id;
    } else {
      customerId = uuid();
      await db.execute({ sql: 'INSERT INTO customers (id, store_id, email, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?, ?)', args: [customerId, store.id, customerEmail.toLowerCase(), firstName || null, lastName || null, phone || null] });
    }

    const countResult = await db.execute({ sql: 'SELECT COUNT(*) as cnt FROM orders WHERE store_id = ?', args: [store.id] });
    const orderNumber = (countResult.rows[0].cnt || 0) + 1001;
    const orderId = uuid();

    await db.execute({
      sql: "INSERT INTO orders (id, store_id, customer_id, order_number, status, payment_status, subtotal, shipping, tax, total, shipping_name, shipping_addr, shipping_city, shipping_country) VALUES (?, ?, ?, ?, 'pending', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [orderId, store.id, customerId, orderNumber, subtotal, shipping, tax, total, shippingAddress.name || `${firstName || ''} ${lastName || ''}`.trim() || null, shippingAddress.address || null, shippingAddress.city || null, shippingAddress.country || null]
    });

    for (const { product, qty } of resolved) {
      await db.execute({ sql: 'INSERT INTO order_items (id, order_id, product_id, title, price, quantity) VALUES (?, ?, ?, ?, ?, ?)', args: [uuid(), orderId, product.id, product.title, product.price, qty] });
      if (product.track_qty) {
        await db.execute({ sql: 'UPDATE products SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [qty, product.id] });
      }
    }

    res.status(201).json({ message: 'Order placed successfully!', orderNumber, orderId, total, estimatedDelivery: '3–5 business days' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Checkout failed. Please try again.' });
  }
});

module.exports = router;
