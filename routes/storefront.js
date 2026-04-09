// routes/storefront.js — public routes, no auth needed
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
let emailModule = null;
try { emailModule = require('../email'); } catch(e) {}

// ── GET STORE INFO ─────────────────────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({
      sql: `SELECT id, name, slug, description, category, currency, logo_url, favicon_url,
            announcement_bar, announcement_bar_enabled, primary_color, accent_color,
            theme_settings, shipping_zones, tax_rate, tax_included, tax_enabled
            FROM stores WHERE slug = ? AND status = 'active'`,
      args: [req.params.slug]
    });
    if (!result.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const store = result.rows[0];
    store.shipping_zones = safeJson(store.shipping_zones, []);
    store.theme_settings = safeJson(store.theme_settings, {});
    res.json(store);
  } catch(err) { res.status(500).json({ error: 'Failed to fetch store.' }); }
});

// ── LIST PRODUCTS (public) ─────────────────────────────────────────────────────
router.get('/:slug/products', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: `SELECT id FROM stores WHERE slug = ? AND status = 'active'`, args: [req.params.slug] });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const store = storeResult.rows[0];
    const { collection, search, sort = 'newest', page = 1, limit = 24 } = req.query;
    let sql = `SELECT p.* FROM products p`;
    const args = [];
    if (collection) {
      sql += ` JOIN product_collections pc ON p.id = pc.product_id JOIN collections c ON pc.collection_id = c.id`;
    }
    sql += ` WHERE p.store_id = ? AND p.status = 'active'`;
    args.push(store.id);
    if (collection) { sql += ` AND (c.slug = ? OR c.id = ?)`; args.push(collection, collection); }
    if (search) { sql += ` AND p.title LIKE ?`; args.push(`%${search}%`); }
    const sortMap = { newest: 'p.created_at DESC', oldest: 'p.created_at ASC', 'price-asc': 'p.price ASC', 'price-desc': 'p.price DESC', 'title-asc': 'p.title ASC' };
    sql += ` ORDER BY ${sortMap[sort]||'p.created_at DESC'} LIMIT ? OFFSET ?`;
    args.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
    const result = await db.execute({ sql, args });
    const products = result.rows.map(p => ({ ...p, images: safeJson(p.images, []) }));
    const countSql = collection
      ? `SELECT COUNT(*) as total FROM products p JOIN product_collections pc ON p.id=pc.product_id JOIN collections c ON pc.collection_id=c.id WHERE p.store_id=? AND p.status='active' AND (c.slug=? OR c.id=?)`
      : `SELECT COUNT(*) as total FROM products WHERE store_id=? AND status='active'`;
    const countArgs = collection ? [store.id, collection, collection] : [store.id];
    const countResult = await db.execute({ sql: countSql, args: countArgs });
    res.json({ products, total: countResult.rows[0].total });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to fetch products.' }); }
});

// ── GET ONE PRODUCT (public) ───────────────────────────────────────────────────
router.get('/:slug/products/:productId', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: 'SELECT id FROM stores WHERE slug = ?', args: [req.params.slug] });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const result = await db.execute({
      sql: `SELECT * FROM products WHERE id = ? AND store_id = ? AND status = 'active'`,
      args: [req.params.productId, storeResult.rows[0].id]
    });
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
    const p = result.rows[0];
    // Load variants if product has them
    const variants = await db.execute({ sql: 'SELECT * FROM product_variants WHERE product_id = ? ORDER BY position', args: [p.id] });
    const options = await db.execute({ sql: 'SELECT * FROM product_options WHERE product_id = ? ORDER BY position', args: [p.id] });
    const optionsWithValues = await Promise.all(options.rows.map(async opt => {
      const vals = await db.execute({ sql: 'SELECT * FROM product_option_values WHERE option_id = ? ORDER BY position', args: [opt.id] });
      return { ...opt, values: vals.rows.map(v => v.value) };
    }));
    res.json({ ...p, images: safeJson(p.images, []), variants: variants.rows, options: optionsWithValues });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch product.' }); }
});

// ── GET COLLECTIONS (public) ───────────────────────────────────────────────────
router.get('/:slug/collections', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: `SELECT id FROM stores WHERE slug = ? AND status = 'active'`, args: [req.params.slug] });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const result = await db.execute({
      sql: `SELECT c.*, COUNT(pc.product_id) as product_count FROM collections c
            LEFT JOIN product_collections pc ON c.id = pc.collection_id
            WHERE c.store_id = ? AND c.status = 'active'
            GROUP BY c.id ORDER BY c.created_at DESC`,
      args: [storeResult.rows[0].id]
    });
    res.json({ collections: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch collections.' }); }
});

// ── VALIDATE DISCOUNT (public) ─────────────────────────────────────────────────
router.post('/:slug/discount/validate', async (req, res) => {
  try {
    const db = getDB();
    const { code, subtotal = 0 } = req.body;
    const storeResult = await db.execute({ sql: `SELECT id FROM stores WHERE slug = ?`, args: [req.params.slug] });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const storeId = storeResult.rows[0].id;
    const result = await db.execute({
      sql: `SELECT * FROM discounts WHERE store_id = ? AND UPPER(code) = UPPER(?) AND status = 'active'`,
      args: [storeId, code]
    });
    if (!result.rows.length) return res.status(404).json({ error: 'Discount code not found.' });
    const disc = result.rows[0];
    const now = new Date();
    if (disc.starts_at && new Date(disc.starts_at) > now) return res.status(400).json({ error: 'Discount has not started yet.' });
    if (disc.ends_at && new Date(disc.ends_at) < now) return res.status(400).json({ error: 'This discount has expired.' });
    if (disc.usage_limit && disc.usage_count >= disc.usage_limit) return res.status(400).json({ error: 'Discount usage limit has been reached.' });
    if (disc.min_order_amount && parseFloat(subtotal) < disc.min_order_amount) {
      return res.status(400).json({ error: `Minimum order of $${disc.min_order_amount.toFixed(2)} required for this discount.` });
    }
    let savings = 0;
    if (disc.type === 'percentage') savings = parseFloat(subtotal) * (disc.value / 100);
    else if (disc.type === 'fixed') savings = Math.min(disc.value, parseFloat(subtotal));
    else if (disc.type === 'free_shipping') savings = 0;
    res.json({ valid: true, discount: { code: disc.code, type: disc.type, value: disc.value }, savings: parseFloat(savings.toFixed(2)) });
  } catch(err) { res.status(500).json({ error: 'Failed to validate discount.' }); }
});

// ── CHECKOUT ──────────────────────────────────────────────────────────────────
router.post('/:slug/checkout', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: `SELECT * FROM stores WHERE slug = ? AND status = 'active'`, args: [req.params.slug] });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const store = storeResult.rows[0];
    const {
      customerEmail, firstName, lastName, phone,
      items, shippingAddress = {},
      discountCode, shippingRateId,
      utmSource, utmMedium, utmCampaign, referrer,
    } = req.body;
    if (!customerEmail) return res.status(400).json({ error: 'Email is required.' });
    if (!items?.length) return res.status(400).json({ error: 'Your cart is empty.' });

    // Resolve items + calculate subtotal
    let subtotal = 0;
    const resolved = [];
    for (const item of items) {
      const pResult = await db.execute({
        sql: `SELECT * FROM products WHERE id = ? AND store_id = ? AND status = 'active'`,
        args: [item.productId, store.id]
      });
      if (!pResult.rows.length) return res.status(400).json({ error: `Product not found: ${item.productId}` });
      const product = pResult.rows[0];
      let variant = null;
      let itemPrice = product.price;
      if (item.variantId) {
        const vResult = await db.execute({ sql: 'SELECT * FROM product_variants WHERE id = ? AND product_id = ?', args: [item.variantId, product.id] });
        if (vResult.rows.length) { variant = vResult.rows[0]; itemPrice = variant.price; }
      }
      const qty = parseInt(item.quantity) || 1;
      // Stock check
      const stockQty = variant ? (variant.quantity || 0) : (product.quantity || 0);
      const trackQty = variant ? variant.track_qty : product.track_qty;
      const continueSelling = variant ? variant.continue_selling : product.continue_selling;
      if (trackQty && !continueSelling && stockQty < qty) {
        return res.status(400).json({ error: `"${product.title}" only has ${stockQty} left in stock.` });
      }
      subtotal += itemPrice * qty;
      resolved.push({ product, variant, qty, itemPrice });
    }

    // Shipping calculation — supports multi-rate zones
    let shipping = 0;
    try {
      const zones = safeJson(store.shipping_zones, []);
      if (zones.length > 0) {
        const zone = zones[0];
        // Check for new multi-rate format
        if (zone.rates && zone.rates.length > 0) {
          const rate = zone.rates[0];
          const r = parseFloat(rate.rate) || 0;
          const freeOver = rate.free_over ? parseFloat(rate.free_over) : null;
          shipping = (freeOver !== null && subtotal >= freeOver) ? 0 : r;
        } else {
          // Legacy single-rate format
          const rate = parseFloat(zone.rate) || 0;
          const freeOver = zone.free_over ? parseFloat(zone.free_over) : null;
          shipping = (freeOver !== null && subtotal >= freeOver) ? 0 : rate;
        }
      }
    } catch(e) { shipping = 0; }

    // Discount
    let discountAmount = 0;
    let discountObj = null;
    if (discountCode) {
      const discResult = await db.execute({
        sql: `SELECT * FROM discounts WHERE store_id = ? AND UPPER(code) = UPPER(?) AND status = 'active'`,
        args: [store.id, discountCode]
      });
      if (discResult.rows.length) {
        const disc = discResult.rows[0];
        const now = new Date();
        const valid = (!disc.starts_at || new Date(disc.starts_at) <= now) &&
                      (!disc.ends_at || new Date(disc.ends_at) >= now) &&
                      (!disc.usage_limit || disc.usage_count < disc.usage_limit) &&
                      (!disc.min_order_amount || subtotal >= disc.min_order_amount);
        if (valid) {
          if (disc.type === 'percentage') discountAmount = subtotal * (disc.value / 100);
          else if (disc.type === 'fixed') discountAmount = Math.min(disc.value, subtotal);
          else if (disc.type === 'free_shipping') { shipping = 0; }
          discountAmount = parseFloat(discountAmount.toFixed(2));
          discountObj = disc;
        }
      }
    }

    // Tax calculation
    let tax = 0;
    if (store.tax_enabled) {
      const taxableAmount = subtotal - discountAmount;
      tax = parseFloat((taxableAmount * (store.tax_rate / 100)).toFixed(2));
    }

    const total = parseFloat((subtotal - discountAmount + shipping + tax).toFixed(2));

    // Get or create customer
    let customerId;
    const custResult = await db.execute({
      sql: 'SELECT id FROM customers WHERE store_id = ? AND email = ?',
      args: [store.id, customerEmail.toLowerCase()]
    });
    if (custResult.rows.length) {
      customerId = custResult.rows[0].id;
      await db.execute({
        sql: 'UPDATE customers SET orders_count = orders_count + 1, total_spent = total_spent + ? WHERE id = ?',
        args: [total, customerId]
      });
    } else {
      customerId = uuid();
      await db.execute({
        sql: 'INSERT INTO customers (id, store_id, email, first_name, last_name, phone, city, country, orders_count, total_spent) VALUES (?,?,?,?,?,?,?,?,1,?)',
        args: [customerId, store.id, customerEmail.toLowerCase(), firstName||null, lastName||null, phone||null,
          shippingAddress.city||null, shippingAddress.country||null, total]
      });
    }

    const countResult = await db.execute({ sql: 'SELECT COALESCE(MAX(order_number), 1000) as max_num FROM orders WHERE store_id = ?', args: [store.id] });
    const orderNumber = (countResult.rows[0].max_num || 1000) + 1;
    const orderId = uuid();

    await db.execute({
      sql: `INSERT INTO orders (id, store_id, customer_id, customer_email, order_number, status, payment_status, fulfillment_status,
            subtotal, shipping, tax, discount_amount, total, discount_code, source,
            shipping_name, shipping_addr, shipping_city, shipping_zip, shipping_country, shipping_phone, processed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [orderId, store.id, customerId, customerEmail.toLowerCase(), orderNumber,
        'open', 'pending', 'unfulfilled',
        subtotal, shipping, tax, discountAmount, total,
        discountObj ? discountCode : null, 'online_store',
        shippingAddress.name || `${firstName||''} ${lastName||''}`.trim() || null,
        shippingAddress.address||null, shippingAddress.city||null,
        shippingAddress.zip||null, shippingAddress.country||null, phone||null,
        new Date().toISOString()]
    });

    // Create order items + decrement stock
    for (const { product, variant, qty, itemPrice } of resolved) {
      await db.execute({
        sql: 'INSERT INTO order_items (id, order_id, product_id, variant_id, title, variant_title, sku, price, quantity) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [uuid(), orderId, product.id, variant?.id||null,
          product.title, variant?.title||null, variant?.sku||product.sku||null, itemPrice, qty]
      });
      // Decrement stock
      if (variant) {
        await db.execute({ sql: 'UPDATE product_variants SET quantity = MAX(0, quantity - ?) WHERE id = ?', args: [qty, variant.id] });
      }
      if (product.track_qty) {
        await db.execute({ sql: 'UPDATE products SET quantity = MAX(0, quantity - ?) WHERE id = ?', args: [qty, product.id] });
        await db.execute({
          sql: 'INSERT INTO inventory_movements (id, product_id, store_id, adjustment, quantity_after, reason) VALUES (?,?,?,?,quantity,?)',
          args: [uuid(), product.id, store.id, -qty, 'order_placed']
        });
      }
    }

    // Increment discount usage
    if (discountObj) {
      await db.execute({ sql: 'UPDATE discounts SET usage_count = usage_count + 1 WHERE id = ?', args: [discountObj.id] });
    }

    // Track analytics event
    try {
      await db.execute({
        sql: `INSERT INTO analytics_events (id, store_id, event_type, utm_source, utm_medium, utm_campaign, referrer, data)
              VALUES (?,?,?,?,?,?,?,?)`,
        args: [uuid(), store.id, 'order_placed',
          utmSource||null, utmMedium||null, utmCampaign||null, referrer||null,
          JSON.stringify({ order_id: orderId, total })]
      });
    } catch(e) { /* analytics tracking failure should not break order */ }

    // Send order confirmation emails
    if (emailModule) {
      try {
        const itemsForEmail = resolved.map(({product, variant, qty, itemPrice}) => ({
          title: product.title,
          variant_title: variant?.title || null,
          price: itemPrice,
          quantity: qty,
        }));
        const storeUrl = process.env.STORE_URL || `https://${store.slug}.sivra.app`;
        const adminUrl = process.env.ADMIN_URL || storeUrl;
        const orderForEmail = {
          order_number: orderNumber,
          total, subtotal, shipping, tax,
          discount_amount: discountAmount,
          customer_email: customerEmail,
          shipping_name: shippingAddress.name || `${firstName||''} ${lastName||''}`.trim(),
          shipping_addr: shippingAddress.address,
          shipping_city: shippingAddress.city,
          shipping_zip: shippingAddress.zip,
          shipping_country: shippingAddress.country,
        };
        // Customer confirmation
        const custTmpl = emailModule.orderConfirmationEmail({
          order: orderForEmail,
          storeName: store.name || 'Our Store',
          storeUrl, items: itemsForEmail,
        });
        await emailModule.sendEmail({ to: customerEmail, ...custTmpl });
        // Admin notification
        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
          const adminTmpl = emailModule.newOrderAdminEmail({
            order: orderForEmail,
            storeName: store.name || 'Our Store',
            adminUrl: `${adminUrl}/sivra-order-detail.html?id=${orderId}`,
            items: itemsForEmail,
          });
          await emailModule.sendEmail({ to: adminEmail, ...adminTmpl });
        }
      } catch(emailErr) {
        console.error('Email error (non-fatal):', emailErr.message);
      }
    }

    res.status(201).json({
      message: 'Order placed successfully!',
      orderNumber, orderId, total, subtotal, shipping, tax, discountAmount,
      estimatedDelivery: '3–5 business days'
    });
  } catch(err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Checkout failed. Please try again.' });
  }
});

// ── HELPER ────────────────────────────────────────────────────────────────────
function safeJson(v, fallback) {
  if (!v) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch(e) { return fallback; }
}


// ── PUBLIC PAGES ──────────────────────────────────────────────────────────────
router.get('/:slug/pages/:pageSlug', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({
      sql: "SELECT id FROM stores WHERE slug = ?", args: [req.params.slug]
    });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const storeId = storeResult.rows[0].id;

    // Try store_pages table first
    const result = await db.execute({
      sql: "SELECT * FROM store_pages WHERE store_id = ? AND slug = ? AND status = 'published'",
      args: [storeId, req.params.pageSlug]
    });
    if (result.rows.length) return res.json(result.rows[0]);

    // Fall back to pages table
    const result2 = await db.execute({
      sql: "SELECT * FROM pages WHERE store_id = ? AND slug = ? AND status = 'published'",
      args: [storeId, req.params.pageSlug]
    });
    if (result2.rows.length) return res.json(result2.rows[0]);

    res.status(404).json({ error: 'Page not found.' });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch page.' }); }
});



router.get('/:slug/order-status', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: `SELECT id FROM stores WHERE slug = ?`, args: [req.params.slug] });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const storeId = storeResult.rows[0].id;
    const { id, num, email } = req.query;
    let orderResult;
    if (id) {
      orderResult = await db.execute({ sql: 'SELECT * FROM orders WHERE id=? AND store_id=?', args: [id, storeId] });
    } else if (num && email) {
      orderResult = await db.execute({
        sql: 'SELECT * FROM orders WHERE order_number=? AND store_id=? AND LOWER(customer_email)=LOWER(?)',
        args: [parseInt(num), storeId, email]
      });
    } else {
      return res.status(400).json({ error: 'Provide id or num+email' });
    }
    if (!orderResult.rows.length) return res.status(404).json({ error: 'Order not found. Check your order number and email address.' });
    const order = orderResult.rows[0];
    const items = await db.execute({ sql: 'SELECT * FROM order_items WHERE order_id=?', args: [order.id] });
    const fulfillments = await db.execute({ sql: 'SELECT * FROM fulfillments WHERE order_id=? ORDER BY created_at DESC', args: [order.id] });
    res.json({ order: { ...order, items: items.rows }, fulfillments: fulfillments.rows });
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to fetch order.' }); }
});


// ── ABANDONED CHECKOUT CAPTURE (public) ──────────────────────────────────────
router.post('/:slug/checkout-started', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: `SELECT id FROM stores WHERE slug=?`, args: [req.params.slug] });
    if (!storeResult.rows.length) return res.status(404).json({ error: 'Store not found.' });
    const storeId = storeResult.rows[0].id;
    const { email, cart, total, currency } = req.body;

    // Create table if needed
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS abandoned_checkouts (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, email TEXT,
        cart TEXT DEFAULT '[]', total REAL DEFAULT 0, currency TEXT DEFAULT 'USD',
        recovery_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, args: []
    });

    const { v4: uuid } = require('uuid');
    const id = uuid();
    await db.execute({
      sql: `INSERT OR REPLACE INTO abandoned_checkouts (id, store_id, email, cart, total, currency)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, storeId, email || null, JSON.stringify(cart || []), parseFloat(total) || 0, currency || 'USD']
    });
    res.json({ id });
  } catch(err) { res.status(500).json({ error: 'Failed.' }); }
});


// ── PUBLIC MENUS ─────────────────────────────────────────────────────────────
router.get('/:slug/menus', async (req, res) => {
  try {
    const db = getDB();
    const storeResult = await db.execute({ sql: 'SELECT id FROM stores WHERE slug=?', args: [req.params.slug] });
    if (!storeResult.rows.length) return res.json({ items: [] });
    const storeId = storeResult.rows[0].id;
    try {
      const result = await db.execute({
        sql: 'SELECT items FROM menus WHERE store_id=? AND handle=? LIMIT 1',
        args: [storeId, 'main']
      });
      if (result.rows.length) {
        return res.json({ items: JSON.parse(result.rows[0].items || '[]') });
      }
    } catch(e) {}
    res.json({ items: [] });
  } catch(err) { res.json({ items: [] }); }
});

module.exports = router;
