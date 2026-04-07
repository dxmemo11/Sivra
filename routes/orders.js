// routes/orders.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
let emailModule = null;
try { emailModule = require('../email'); } catch(e) {}

async function tryEmail(fn) {
  if (!emailModule) return;
  try { await fn(); } catch(e) { console.error('Email send error:', e.message); }
}

router.use(requireAuth);

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function addEvent(db, orderId, eventType, message, data = null) {
  await db.execute({
    sql: 'INSERT INTO order_events (id, order_id, event_type, message, data) VALUES (?,?,?,?,?)',
    args: [uuid(), orderId, eventType, message, data ? JSON.stringify(data) : null]
  });
}

async function getOrderWithItems(db, orderId) {
  const orderResult = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [orderId] });
  if (!orderResult.rows.length) return null;
  const order = orderResult.rows[0];
  const items = await db.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [orderId] });
  const events = await db.execute({ sql: 'SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC', args: [orderId] });
  const fulfillments = await db.execute({ sql: 'SELECT * FROM fulfillments WHERE order_id = ? ORDER BY created_at DESC', args: [orderId] });
  const refunds = await db.execute({ sql: 'SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at DESC', args: [orderId] });
  return {
    ...order,
    items: items.rows,
    events: events.rows,
    fulfillments: fulfillments.rows,
    refunds: refunds.rows,
    items_count: items.rows.reduce((s, i) => s + (i.quantity || 1), 0),
  };
}

// ── LIST ORDERS ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { status, payment_status, fulfillment_status, search, sort = 'newest', page = 1, limit = 50 } = req.query;
    let sql = 'SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as items_count FROM orders o WHERE o.store_id = ?';
    const args = [req.storeId];
    if (status && status !== 'all') { sql += ' AND o.status = ?'; args.push(status); }
    if (payment_status) { sql += ' AND o.payment_status = ?'; args.push(payment_status); }
    if (fulfillment_status) { sql += ' AND o.fulfillment_status = ?'; args.push(fulfillment_status); }
    if (search) {
      sql += ' AND (CAST(o.order_number AS TEXT) LIKE ? OR o.shipping_name LIKE ? OR o.customer_email LIKE ?)';
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const sortMap = {
      newest: 'o.created_at DESC', oldest: 'o.created_at ASC',
      'total-desc': 'o.total DESC', 'total-asc': 'o.total ASC',
    };
    sql += ` ORDER BY ${sortMap[sort] || 'o.created_at DESC'} LIMIT ? OFFSET ?`;
    args.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
    const result = await db.execute({ sql, args });
    const countResult = await db.execute({ sql: 'SELECT COUNT(*) as total FROM orders WHERE store_id = ?', args: [req.storeId] });
    res.json({ orders: result.rows, total: countResult.rows[0].total });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// ── GET ONE ORDER ─────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const order = await getOrderWithItems(db, req.params.id);
    if (!order || order.store_id !== req.storeId) return res.status(404).json({ error: 'Order not found.' });
    // Get customer
    if (order.customer_id) {
      const cust = await db.execute({ sql: 'SELECT * FROM customers WHERE id = ?', args: [order.customer_id] });
      if (cust.rows.length) order.customer = cust.rows[0];
    }
    res.json(order);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// ── UPDATE ORDER ──────────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { status, payment_status, fulfillment_status, notes, tags, financial_status } = req.body;
    const existing = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!existing.rows.length) return res.status(404).json({ error: 'Order not found.' });
    const old = existing.rows[0];

    await db.execute({
      sql: `UPDATE orders SET
            status=COALESCE(?,status), payment_status=COALESCE(?,payment_status),
            fulfillment_status=COALESCE(?,fulfillment_status),
            financial_status=COALESCE(?,financial_status),
            notes=COALESCE(?,notes), tags=COALESCE(?,tags),
            updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?`,
      args: [status||null, payment_status||null, fulfillment_status||null,
        financial_status||null, notes!==undefined?notes||null:null,
        tags!==undefined?tags||null:null, req.params.id, req.storeId]
    });

    // Log events for status changes
    if (payment_status && payment_status !== old.payment_status) {
      await addEvent(db, req.params.id, 'payment_status_changed', `Payment status changed to ${payment_status}`);
    }
    if (fulfillment_status && fulfillment_status !== old.fulfillment_status) {
      await addEvent(db, req.params.id, 'fulfillment_status_changed', `Fulfillment status changed to ${fulfillment_status}`);
    }

    const updated = await getOrderWithItems(db, req.params.id);
    res.json(updated);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order.' });
  }
});

// ── ADD NOTE / EVENT ──────────────────────────────────────────────────────────
router.post('/:id/notes', async (req, res) => {
  try {
    const db = getDB();
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required.' });
    await addEvent(db, req.params.id, 'note', message.trim());
    // Update notes field too
    await db.execute({
      sql: 'UPDATE orders SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?',
      args: [message, req.params.id, req.storeId]
    });
    res.json({ message: 'Note added.' });
  } catch(err) { res.status(500).json({ error: 'Failed to add note.' }); }
});

// ── FULFILL ORDER ─────────────────────────────────────────────────────────────
router.post('/:id/fulfill', async (req, res) => {
  try {
    const db = getDB();
    const { tracking_number, tracking_company, tracking_url, notify_customer = true, items } = req.body;
    const order = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found.' });

    const fulfillId = uuid();
    await db.execute({
      sql: `INSERT INTO fulfillments (id, order_id, store_id, status, tracking_number, tracking_company, tracking_url, items, notify_customer)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [fulfillId, req.params.id, req.storeId, 'fulfilled',
        tracking_number||null, tracking_company||null, tracking_url||null,
        JSON.stringify(items||[]), notify_customer?1:0]
    });

    await db.execute({
      sql: `UPDATE orders SET fulfillment_status='fulfilled', updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?`,
      args: [req.params.id, req.storeId]
    });

    const msg = tracking_number
      ? `Order fulfilled with tracking: ${tracking_number} (${tracking_company||''})`
      : 'Order fulfilled';
    await addEvent(db, req.params.id, 'fulfillment_created', msg, { tracking_number, tracking_company, tracking_url });

    // Send shipping confirmation email
    const orderForEmail = await getOrderWithItems(db, req.params.id);
    const storeInfo = await db.execute({ sql: 'SELECT name, slug FROM stores WHERE id=?', args: [req.storeId] });
    const store = storeInfo.rows[0] || {};
    if (orderForEmail?.customer_email && emailModule) {
      await tryEmail(async () => {
        const tmpl = emailModule.shippingConfirmationEmail({
          order: orderForEmail,
          storeName: store.name || 'Our Store',
          trackingNumber: tracking_number,
          trackingCompany: tracking_company,
          trackingUrl: tracking_url,
        });
        await emailModule.sendEmail({ to: orderForEmail.customer_email, ...tmpl });
      });
    }

    res.json({ message: 'Order fulfilled.', fulfillment_id: fulfillId });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fulfill order.' });
  }
});

// ── REFUND ORDER ──────────────────────────────────────────────────────────────
router.post('/:id/refund', async (req, res) => {
  try {
    const db = getDB();
    const { amount, reason, note, restock = false, items = [] } = req.body;
    const order = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found.' });
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Refund amount must be greater than 0.' });
    const orderTotal = parseFloat(order.rows[0].total || 0);
    if (parseFloat(amount) > orderTotal) return res.status(400).json({ error: `Refund cannot exceed order total ($${orderTotal.toFixed(2)}).` });

    const refundId = uuid();
    await db.execute({
      sql: 'INSERT INTO refunds (id, order_id, store_id, amount, reason, note, restock, items) VALUES (?,?,?,?,?,?,?,?)',
      args: [refundId, req.params.id, req.storeId, parseFloat(amount), reason||null, note||null, restock?1:0, JSON.stringify(items)]
    });

    // Restock if requested
    if (restock && items.length) {
      for (const item of items) {
        if (item.product_id && item.quantity) {
          await db.execute({
            sql: 'UPDATE products SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            args: [parseInt(item.quantity), item.product_id]
          });
          await db.execute({
            sql: 'INSERT INTO inventory_movements (id, product_id, store_id, adjustment, quantity_after, reason) VALUES (?,?,?,?,quantity,?)',
            args: [uuid(), item.product_id, req.storeId, parseInt(item.quantity), 'refund_restock']
          });
        }
      }
    }

    await db.execute({
      sql: `UPDATE orders SET payment_status='refunded', updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?`,
      args: [req.params.id, req.storeId]
    });

    await addEvent(db, req.params.id, 'refund_created', `Manual refund of $${parseFloat(amount).toFixed(2)} recorded. Reason: ${reason||'Not specified'}`, { amount, reason });

    res.json({ message: 'Refund recorded.', refund_id: refundId });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record refund.' });
  }
});

// ── CANCEL ORDER ──────────────────────────────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  try {
    const db = getDB();
    const { reason = 'other', restock = false } = req.body;
    const order = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found.' });
    if (order.rows[0].status === 'cancelled') return res.status(400).json({ error: 'Order is already cancelled.' });

    await db.execute({
      sql: `UPDATE orders SET status='cancelled', cancel_reason=?, cancelled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?`,
      args: [reason, req.params.id, req.storeId]
    });

    // Restock if requested
    if (restock) {
      const items = await db.execute({ sql: 'SELECT * FROM order_items WHERE order_id = ?', args: [req.params.id] });
      for (const item of items.rows) {
        if (item.product_id) {
          await db.execute({
            sql: 'UPDATE products SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            args: [item.quantity || 1, item.product_id]
          });
          await db.execute({
            sql: 'INSERT INTO inventory_movements (id, product_id, store_id, adjustment, quantity_after, reason) VALUES (?,?,?,?,quantity,?)',
            args: [uuid(), item.product_id, req.storeId, item.quantity || 1, 'order_cancelled']
          });
        }
      }
    }

    await addEvent(db, req.params.id, 'order_cancelled', `Order cancelled. Reason: ${reason}.${restock?' Stock restocked.':''}`);
    res.json({ message: 'Order cancelled.' });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel order.' });
  }
});

// ── TIMELINE / EVENTS ─────────────────────────────────────────────────────────
router.get('/:id/events', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC', args: [req.params.id] });
    res.json({ events: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch events.' }); }
});

// ── CREATE ORDER (manual) ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = getDB();
    const { customerId, customerEmail, items = [], subtotal = 0, shipping = 0, tax = 0, total = 0, notes, source = 'manual', shippingAddress = {} } = req.body;
    if (!items.length) return res.status(400).json({ error: 'Order must have at least one item.' });

    const countResult = await db.execute({ sql: 'SELECT COUNT(*) as cnt FROM orders WHERE store_id = ?', args: [req.storeId] });
    const orderNumber = (countResult.rows[0].cnt || 0) + 1001;
    const orderId = uuid();

    await db.execute({
      sql: `INSERT INTO orders (id, store_id, customer_id, customer_email, order_number, status, payment_status, fulfillment_status,
            subtotal, shipping, tax, total, notes, source, shipping_name, shipping_addr, shipping_city, shipping_country, processed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [orderId, req.storeId, customerId||null, customerEmail||null, orderNumber,
        'open', 'pending', 'unfulfilled',
        parseFloat(subtotal)||0, parseFloat(shipping)||0, parseFloat(tax)||0, parseFloat(total)||0,
        notes||null, source,
        shippingAddress.name||null, shippingAddress.address||null,
        shippingAddress.city||null, shippingAddress.country||null,
        new Date().toISOString()]
    });

    for (const item of items) {
      await db.execute({
        sql: 'INSERT INTO order_items (id, order_id, product_id, variant_id, title, variant_title, price, quantity) VALUES (?,?,?,?,?,?,?,?)',
        args: [uuid(), orderId, item.productId||item.product_id||null, item.variantId||null,
          item.title||'Item', item.variant_title||null, parseFloat(item.price)||0, parseInt(item.quantity)||1]
      });
    }

    await addEvent(db, orderId, 'order_created', `Order #${orderNumber} created via ${source}`);
    const created = await getOrderWithItems(db, orderId);
    res.status(201).json(created);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order.' });
  }
});

module.exports = router;
