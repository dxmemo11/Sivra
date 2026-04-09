// routes/products.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

// ── HELPERS ──────────────────────────────────────────────────────────────────
function parseProduct(p) {
  if (!p) return null;
  return {
    ...p,
    images: safeJson(p.images, []),
    has_variants: !!p.has_variants,
    track_qty: p.track_qty !== 0,
    taxable: p.taxable !== 0,
    continue_selling: !!p.continue_selling,
  };
}
function safeJson(v, fallback) {
  if (!v) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch(e) { return fallback; }
}

// ── IMAGE UPLOAD ──────────────────────────────────────────────────────────────
router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided.' });
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    res.json({ url: `data:${mimeType};base64,${base64}` });
  } catch(err) {
    res.status(500).json({ error: 'Image upload failed.' });
  }
});

// ── LIST PRODUCTS ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { status, vendor, category, search, sort = 'newest', page = 1, limit = 50 } = req.query;
    let sql = 'SELECT * FROM products WHERE store_id = ?';
    const args = [req.storeId];
    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (vendor) { sql += ' AND vendor = ?'; args.push(vendor); }
    if (category) { sql += ' AND category = ?'; args.push(category); }
    if (search) { sql += ' AND (title LIKE ? OR sku LIKE ? OR vendor LIKE ?)'; args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const sortMap = {
      newest: 'created_at DESC', oldest: 'created_at ASC',
      'title-asc': 'title ASC', 'title-desc': 'title DESC',
      'price-asc': 'price ASC', 'price-desc': 'price DESC',
    };
    sql += ` ORDER BY ${sortMap[sort] || 'created_at DESC'}`;
    sql += ' LIMIT ? OFFSET ?';
    args.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
    const result = await db.execute({ sql, args });
    const products = result.rows.map(parseProduct);
    const countResult = await db.execute({ sql: 'SELECT COUNT(*) as total FROM products WHERE store_id = ?', args: [req.storeId] });
    res.json({ products, total: countResult.rows[0].total });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

// ── GET ONE PRODUCT ───────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT * FROM products WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
    const product = parseProduct(result.rows[0]);
    // Load variants
    const variants = await db.execute({ sql: 'SELECT * FROM product_variants WHERE product_id = ? ORDER BY position', args: [req.params.id] });
    // Load options
    const options = await db.execute({ sql: 'SELECT * FROM product_options WHERE product_id = ? ORDER BY position', args: [req.params.id] });
    const optionsWithValues = await Promise.all(options.rows.map(async opt => {
      const vals = await db.execute({ sql: 'SELECT * FROM product_option_values WHERE option_id = ? ORDER BY position', args: [opt.id] });
      return { ...opt, values: vals.rows.map(v => v.value) };
    }));
    // Load collections
    const colls = await db.execute({
      sql: 'SELECT c.id, c.name FROM collections c JOIN product_collections pc ON c.id = pc.collection_id WHERE pc.product_id = ?',
      args: [req.params.id]
    });
    res.json({ ...product, variants: variants.rows, options: optionsWithValues, collections: colls.rows });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product.' });
  }
});

// ── CREATE PRODUCT ────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = getDB();
    const {
      title, description, body_html, price, comparePrice, compare_price,
      cost_per_item, sku, barcode, quantity = 0, trackQty = true, track_qty,
      continue_selling = false, weight = 0, weight_unit = 'kg',
      category, product_type, vendor, tags, status = 'active',
      seo_title, seo_description, seo_handle, taxable = true,
      images = [], options = [], variants = [],
    } = req.body;

    if (!title) return res.status(400).json({ error: 'Product title is required.' });
    if (price === undefined || price === '') return res.status(400).json({ error: 'Price is required.' });

    const id = uuid();
    const hasVariants = variants.length > 0;
    const finalPrice = parseFloat(price) || 0;
    const finalCompare = compareFloat(comparePrice || compare_price);
    const trackQ = trackQty !== undefined ? (trackQty ? 1 : 0) : (track_qty !== undefined ? (track_qty ? 1 : 0) : 1);

    await db.execute({
      sql: `INSERT INTO products (id, store_id, title, description, body_html, price, compare_price,
            cost_per_item, sku, barcode, quantity, track_qty, continue_selling, weight, weight_unit,
            category, product_type, vendor, tags, status, has_variants,
            seo_title, seo_description, seo_handle, taxable, images, published_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, req.storeId, title, description||null, body_html||null,
        finalPrice, finalCompare, parseFloat(cost_per_item)||null,
        sku||null, barcode||null, parseInt(quantity)||0,
        trackQ, continue_selling?1:0,
        parseFloat(weight)||0, weight_unit,
        category||null, product_type||null, vendor||null, tags||null,
        status, hasVariants?1:0,
        seo_title||null, seo_description||null,
        seo_handle || slugify(title),
        taxable?1:0, JSON.stringify(images),
        status==='active'?new Date().toISOString():null
      ]
    });

    // Create options + variants
    if (options.length > 0) {
      await createOptionsAndVariants(db, id, req.storeId, options, variants, finalPrice, finalCompare, trackQ);
    }

    // Record inventory movement
    if (parseInt(quantity) > 0) {
      await db.execute({
        sql: 'INSERT INTO inventory_movements (id, product_id, store_id, adjustment, quantity_after, reason) VALUES (?,?,?,?,?,?)',
        args: [uuid(), id, req.storeId, parseInt(quantity)||0, parseInt(quantity)||0, 'initial']
      });
    }

    const created = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] });
    res.status(201).json(parseProduct(created.rows[0]));
  } catch(err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

// ── UPDATE PRODUCT ────────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const {
      title, description, body_html, price, comparePrice, compare_price,
      cost_per_item, sku, barcode, quantity, trackQty, track_qty,
      continue_selling, weight, weight_unit, category, product_type,
      vendor, tags, status, seo_title, seo_description, seo_handle,
      taxable, images,
    } = req.body;

    const existing = await db.execute({ sql: 'SELECT * FROM products WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!existing.rows.length) return res.status(404).json({ error: 'Product not found.' });
    const p = existing.rows[0];

    const newQty = quantity !== undefined ? parseInt(quantity) : null;
    const oldQty = p.quantity || 0;

    await db.execute({
      sql: `UPDATE products SET
        title=COALESCE(?,title), description=COALESCE(?,description),
        body_html=COALESCE(?,body_html),
        price=COALESCE(?,price), compare_price=COALESCE(?,compare_price),
        cost_per_item=COALESCE(?,cost_per_item),
        sku=COALESCE(?,sku), barcode=COALESCE(?,barcode),
        quantity=COALESCE(?,quantity),
        track_qty=COALESCE(?,track_qty),
        continue_selling=COALESCE(?,continue_selling),
        weight=COALESCE(?,weight), weight_unit=COALESCE(?,weight_unit),
        category=COALESCE(?,category), product_type=COALESCE(?,product_type),
        vendor=COALESCE(?,vendor), tags=COALESCE(?,tags),
        status=COALESCE(?,status),
        seo_title=COALESCE(?,seo_title), seo_description=COALESCE(?,seo_description),
        seo_handle=COALESCE(?,seo_handle),
        taxable=COALESCE(?,taxable),
        images=COALESCE(?,images),
        published_at=CASE WHEN ? = 'active' AND published_at IS NULL THEN CURRENT_TIMESTAMP ELSE published_at END
        WHERE id=? AND store_id=?`,
      args: [
        title||null, description||null, body_html||null,
        price!==undefined?parseFloat(price):null,
        comparePrice!==undefined||compare_price!==undefined ? compareFloat(comparePrice||compare_price) : null,
        cost_per_item!==undefined?parseFloat(cost_per_item)||null:null,
        sku!==undefined?sku||null:null,
        barcode!==undefined?barcode||null:null,
        newQty,
        trackQty!==undefined?(trackQty?1:0):(track_qty!==undefined?(track_qty?1:0):null),
        continue_selling!==undefined?(continue_selling?1:0):null,
        weight!==undefined?parseFloat(weight)||0:null, weight_unit||null,
        category!==undefined?category||null:null,
        product_type!==undefined?product_type||null:null,
        vendor!==undefined?vendor||null:null,
        tags!==undefined?tags||null:null,
        status||null,
        seo_title!==undefined?seo_title||null:null,
        seo_description!==undefined?seo_description||null:null,
        seo_handle!==undefined?seo_handle||null:null,
        taxable!==undefined?(taxable?1:0):null,
        images!==undefined?JSON.stringify(images):null,
        status||null,
        req.params.id, req.storeId
      ]
    });

    // Record inventory movement if quantity changed
    if (newQty !== null && newQty !== oldQty) {
      await db.execute({
        sql: 'INSERT INTO inventory_movements (id, product_id, store_id, adjustment, quantity_after, reason) VALUES (?,?,?,?,?,?)',
        args: [uuid(), req.params.id, req.storeId, newQty - oldQty, newQty, 'manual_adjustment']
      });
    }

    const updated = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [req.params.id] });
    res.json(parseProduct(updated.rows[0]));
  } catch(err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

// ── DELETE PRODUCT ────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM products WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    await db.execute({ sql: 'DELETE FROM product_variants WHERE product_id = ?', args: [req.params.id] });
    await db.execute({ sql: 'DELETE FROM product_options WHERE product_id = ?', args: [req.params.id] });
    await db.execute({ sql: 'DELETE FROM product_collections WHERE product_id = ?', args: [req.params.id] });
    res.json({ message: 'Product deleted.' });
  } catch(err) {
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

// ── DUPLICATE PRODUCT ─────────────────────────────────────────────────────────
router.post('/:id/duplicate', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT * FROM products WHERE id = ? AND store_id = ?', args: [req.params.id, req.storeId] });
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found.' });
    const p = result.rows[0];
    const newId = uuid();
    await db.execute({
      sql: `INSERT INTO products (id, store_id, title, description, price, compare_price, sku, barcode,
            quantity, track_qty, weight, category, product_type, vendor, tags, status, images,
            seo_title, seo_description, taxable, has_variants)
            SELECT ?, store_id, title || ' (Copy)', description, price, compare_price, sku, barcode,
            quantity, track_qty, weight, category, product_type, vendor, tags, 'draft', images,
            seo_title, seo_description, taxable, has_variants
            FROM products WHERE id = ?`,
      args: [newId, req.params.id]
    });
    const created = await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [newId] });
    res.status(201).json(parseProduct(created.rows[0]));
  } catch(err) {
    res.status(500).json({ error: 'Failed to duplicate product.' });
  }
});

// ── BULK STATUS UPDATE ────────────────────────────────────────────────────────
router.patch('/bulk/status', async (req, res) => {
  try {
    const db = getDB();
    const { ids, status } = req.body;
    if (!ids?.length || !status) return res.status(400).json({ error: 'ids and status required.' });
    for (const id of ids) {
      await db.execute({
        sql: 'UPDATE products SET status = ? WHERE id = ? AND store_id = ?',
        args: [status, id, req.storeId]
      });
    }
    res.json({ message: `${ids.length} products updated.` });
  } catch(err) {
    res.status(500).json({ error: 'Failed to bulk update.' });
  }
});

// ── VARIANTS ──────────────────────────────────────────────────────────────────
router.get('/:id/variants', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql: 'SELECT * FROM product_variants WHERE product_id = ? ORDER BY position', args: [req.params.id] });
    res.json({ variants: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch variants.' }); }
});

router.post('/:id/variants', async (req, res) => {
  try {
    const db = getDB();
    const { title, option1, option2, option3, price, compare_price, sku, barcode, quantity = 0, weight = 0, position = 1, taxable = true, requires_shipping = true } = req.body;
    const id = uuid();
    await db.execute({
      sql: `INSERT INTO product_variants (id, product_id, store_id, title, option1, option2, option3,
            price, compare_price, sku, barcode, quantity, weight, position, taxable, requires_shipping)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, req.params.id, req.storeId, title||'Default', option1||null, option2||null, option3||null,
        parseFloat(price)||0, compare_price?parseFloat(compare_price):null,
        sku||null, barcode||null, parseInt(quantity)||0, parseFloat(weight)||0,
        parseInt(position)||1, taxable?1:0, requires_shipping?1:0]
    });
    // Mark product as having variants
    await db.execute({ sql: 'UPDATE products SET has_variants = 1 WHERE id = ?', args: [req.params.id] });
    const created = await db.execute({ sql: 'SELECT * FROM product_variants WHERE id = ?', args: [id] });
    res.status(201).json(created.rows[0]);
  } catch(err) { console.error(err); res.status(500).json({ error: 'Failed to create variant.' }); }
});

router.patch('/:id/variants/:variantId', async (req, res) => {
  try {
    const db = getDB();
    const { title, option1, option2, option3, price, compare_price, sku, barcode, quantity, weight, position, taxable, requires_shipping } = req.body;
    await db.execute({
      sql: `UPDATE product_variants SET
            title=COALESCE(?,title), option1=COALESCE(?,option1), option2=COALESCE(?,option2), option3=COALESCE(?,option3),
            price=COALESCE(?,price), compare_price=COALESCE(?,compare_price),
            sku=COALESCE(?,sku), barcode=COALESCE(?,barcode),
            quantity=COALESCE(?,quantity), weight=COALESCE(?,weight), position=COALESCE(?,position),
            taxable=COALESCE(?,taxable), requires_shipping=COALESCE(?,requires_shipping)
            WHERE id=? AND product_id=?`,
      args: [title||null, option1||null, option2||null, option3||null,
        price!==undefined?parseFloat(price):null, compare_price!==undefined?parseFloat(compare_price)||null:null,
        sku!==undefined?sku||null:null, barcode!==undefined?barcode||null:null,
        quantity!==undefined?parseInt(quantity):null, weight!==undefined?parseFloat(weight):null,
        position!==undefined?parseInt(position):null,
        taxable!==undefined?(taxable?1:0):null, requires_shipping!==undefined?(requires_shipping?1:0):null,
        req.params.variantId, req.params.id]
    });
    const updated = await db.execute({ sql: 'SELECT * FROM product_variants WHERE id = ?', args: [req.params.variantId] });
    res.json(updated.rows[0]);
  } catch(err) { res.status(500).json({ error: 'Failed to update variant.' }); }
});

router.delete('/:id/variants/:variantId', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql: 'DELETE FROM product_variants WHERE id = ? AND product_id = ?', args: [req.params.variantId, req.params.id] });
    const remaining = await db.execute({ sql: 'SELECT COUNT(*) as cnt FROM product_variants WHERE product_id = ?', args: [req.params.id] });
    if (remaining.rows[0].cnt === 0) {
      await db.execute({ sql: 'UPDATE products SET has_variants = 0 WHERE id = ?', args: [req.params.id] });
    }
    res.json({ message: 'Variant deleted.' });
  } catch(err) { res.status(500).json({ error: 'Failed to delete variant.' }); }
});

// ── INVENTORY MOVEMENTS ───────────────────────────────────────────────────────
router.get('/:id/inventory-movements', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({
      sql: 'SELECT * FROM inventory_movements WHERE product_id = ? AND store_id = ? ORDER BY created_at DESC LIMIT 50',
      args: [req.params.id, req.storeId]
    });
    res.json({ movements: result.rows });
  } catch(err) { res.status(500).json({ error: 'Failed to fetch movements.' }); }
});

// ── HELPER FUNCTIONS ──────────────────────────────────────────────────────────
function compareFloat(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function slugify(str) {
  return (str||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

async function createOptionsAndVariants(db, productId, storeId, options, variants, basePrice, baseCompare, trackQ) {
  // Create options
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const optId = uuid();
    await db.execute({
      sql: 'INSERT INTO product_options (id, product_id, name, position) VALUES (?,?,?,?)',
      args: [optId, productId, opt.name, i+1]
    });
    // Create option values
    for (let j = 0; j < (opt.values||[]).length; j++) {
      await db.execute({
        sql: 'INSERT INTO product_option_values (id, option_id, value, position) VALUES (?,?,?,?)',
        args: [uuid(), optId, opt.values[j], j+1]
      });
    }
  }
  // Create variants
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    await db.execute({
      sql: `INSERT INTO product_variants (id, product_id, store_id, title, option1, option2, option3,
            price, compare_price, sku, barcode, quantity, track_qty, weight, position, taxable)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [uuid(), productId, storeId,
        v.title || [v.option1,v.option2,v.option3].filter(Boolean).join(' / ') || 'Default',
        v.option1||null, v.option2||null, v.option3||null,
        parseFloat(v.price)||basePrice, v.compare_price?parseFloat(v.compare_price):baseCompare,
        v.sku||null, v.barcode||null, parseInt(v.quantity)||0,
        trackQ, parseFloat(v.weight)||0, i+1, v.taxable!==undefined?(v.taxable?1:0):1]
    });
  }
}

module.exports = router;
