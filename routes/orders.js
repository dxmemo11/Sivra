// routes/orders.js
// View and manage orders for a store

const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);


// ── LIST ORDERS ────────────────────────────────────────────────────────────
// GET /api/orders
// Query: status, paymentStatus, search, page, limit
router.get('/', (req, res) => {
  const db = getDB();
  const { status, paymentStatus, search, page = 1, limit = 50 } = req.query;

  let query = `
    SELECT o.*, c.first_name, c.last_name, c.email as customer_email
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.store_id = ?
  `;
  const params = [req.storeId];

  if (status)        { query += ' AND o.status = ?';         params.push(status); }
  if (paymentStatus) { query += ' AND o.payment_status = ?'; params.push(paymentStatus); }
  if (search)        { query += ' AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR CAST(o.order_number AS TEXT) LIKE ?)';
                       const s = `%${search}%`; params.push(s, s, s, s); }

  query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const orders = db.prepare(query).all(...params);

  // Attach items to each order
  const withItems = orders.map(order => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return { ...order, items };
  });

  const { total } = db.prepare('SELECT COUNT(*) as total FROM orders WHERE store_id = ?').get(req.storeId);

  res.json({ orders: withItems, total });
});


// ── GET ONE ORDER ──────────────────────────────────────────────────────────
// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const db = getDB();
  const order = db.prepare(`
    SELECT o.*, c.first_name, c.last_name, c.email as customer_email, c.phone as customer_phone
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.id = ? AND o.store_id = ?
  `).get(req.params.id, req.storeId);

  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ ...order, items });
});


// ── CREATE ORDER (manual) ──────────────────────────────────────────────────
// POST /api/orders
// Body: { customerEmail, items: [{productId, quantity}], shipping, notes, shippingAddress }
router.post('/', (req, res) => {
  const db = getDB();
  const { customerEmail, items, shipping = 0, notes, shippingAddress = {} } = req.body;

  if (!items?.length) return res.status(400).json({ error: 'At least one item is required.' });

  // Resolve products and calculate totals
  let subtotal = 0;
  const resolvedItems = [];

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?')
      .get(item.productId, req.storeId);
    if (!product) return res.status(400).json({ error: `Product ${item.productId} not found.` });

    const qty = parseInt(item.quantity) || 1;
    subtotal += product.price * qty;
    resolvedItems.push({ product, qty });
  }

  const tax = subtotal * 0.08; // 8% tax — make this configurable later
  const total = subtotal + parseFloat(shipping) + tax;

  // Get or create customer
  let customerId = null;
  if (customerEmail) {
    let customer = db.prepare('SELECT * FROM customers WHERE store_id = ? AND email = ?')
      .get(req.storeId, customerEmail.toLowerCase());
    if (!customer) {
      customerId = uuid();
      db.prepare('INSERT INTO customers (id, store_id, email) VALUES (?, ?, ?)')
        .run(customerId, req.storeId, customerEmail.toLowerCase());
    } else {
      customerId = customer.id;
    }
  }

  // Get next order number for this store
  const { maxNum } = db.prepare('SELECT MAX(order_number) as maxNum FROM orders WHERE store_id = ?').get(req.storeId);
  const orderNumber = (maxNum || 1000) + 1;

  const orderId = uuid();

  const createOrder = db.transaction(() => {
    db.prepare(`
      INSERT INTO orders
        (id, store_id, customer_id, order_number, subtotal, shipping, tax, total, notes, shipping_name, shipping_addr, shipping_city, shipping_country)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId, req.storeId, customerId, orderNumber,
      subtotal, parseFloat(shipping), tax, total, notes || null,
      shippingAddress.name || null, shippingAddress.address || null,
      shippingAddress.city || null, shippingAddress.country || null
    );

    for (const { product, qty } of resolvedItems) {
      db.prepare('INSERT INTO order_items (id, order_id, product_id, title, price, quantity) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuid(), orderId, product.id, product.title, product.price, qty);

      // Deduct stock if tracking is enabled
      if (product.track_qty) {
        db.prepare('UPDATE products SET quantity = MAX(0, quantity - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(qty, product.id);
      }
    }
  });

  createOrder();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  res.status(201).json({ ...order, items: orderItems });
});


// ── UPDATE ORDER STATUS ────────────────────────────────────────────────────
// PATCH /api/orders/:id
// Body: { status, paymentStatus, notes }
router.patch('/:id', (req, res) => {
  const db = getDB();
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.id, req.storeId);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const { status, paymentStatus, notes } = req.body;

  db.prepare(`
    UPDATE orders SET
      status         = COALESCE(?, status),
      payment_status = COALESCE(?, payment_status),
      notes          = COALESCE(?, notes),
      updated_at     = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status || null, paymentStatus || null, notes || null, req.params.id);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ ...updated, items });
});


// ── CANCEL / REFUND ORDER ──────────────────────────────────────────────────
// POST /api/orders/:id/cancel
router.post('/:id/cancel', (req, res) => {
  const db = getDB();
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.id, req.storeId);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (['cancelled', 'refunded'].includes(order.status)) {
    return res.status(400).json({ error: 'Order is already cancelled or refunded.' });
  }

  const cancel = db.transaction(() => {
    // Restore stock
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    for (const item of items) {
      if (item.product_id) {
        db.prepare('UPDATE products SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(item.quantity, item.product_id);
      }
    }
    db.prepare("UPDATE orders SET status = 'cancelled', payment_status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(order.id);
  });

  cancel();
  res.json({ message: 'Order cancelled and stock restored.' });
});

module.exports = router;
