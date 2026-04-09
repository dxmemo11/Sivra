// db/database.js — Sivra database layer
// Supports Turso cloud (production) + local SQLite (dev)
const { createClient } = require('@libsql/client');
const path = require('path');
require('dotenv').config();

let db;

function getDB() {
  if (!db) {
    let url, authToken;
    if (process.env.TURSO_DATABASE_URL) {
      url = process.env.TURSO_DATABASE_URL;
      authToken = process.env.TURSO_AUTH_TOKEN;
    } else if (process.env.DB_PATH) {
      url = process.env.DB_PATH.startsWith('file:') ? process.env.DB_PATH : `file:${process.env.DB_PATH}`;
    } else {
      url = `file:${path.join(__dirname, '../sivra.db')}`;
    }
    db = createClient({ url, authToken });
    initTables().catch(e => console.error('DB init error:', e));
  }
  return db;
}

async function initTables() {
  const statements = [
    // ── MERCHANTS ─────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      plan TEXT DEFAULT 'starter', status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── STORES ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL, description TEXT, category TEXT,
      currency TEXT DEFAULT 'USD', logo_url TEXT, favicon_url TEXT,
      status TEXT DEFAULT 'active',
      shipping_zones TEXT DEFAULT '[]',
      tax_rate REAL DEFAULT 0,
      tax_included INTEGER DEFAULT 0,
      tax_enabled INTEGER DEFAULT 0,
      announcement_bar TEXT,
      announcement_bar_enabled INTEGER DEFAULT 0,
      primary_color TEXT DEFAULT '#1a1a1a',
      accent_color TEXT DEFAULT '#008060',
      theme_settings TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── PRODUCTS ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT, body_html TEXT,
      price REAL NOT NULL DEFAULT 0, compare_price REAL,
      cost_per_item REAL,
      sku TEXT, barcode TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      track_qty INTEGER DEFAULT 1,
      continue_selling INTEGER DEFAULT 0,
      weight REAL DEFAULT 0, weight_unit TEXT DEFAULT 'kg',
      category TEXT, product_type TEXT, vendor TEXT, tags TEXT,
      status TEXT DEFAULT 'active',
      has_variants INTEGER DEFAULT 0,
      seo_title TEXT, seo_description TEXT, seo_handle TEXT,
      taxable INTEGER DEFAULT 1,
      images TEXT DEFAULT '[]',
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── PRODUCT OPTIONS ───────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS product_options (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
      name TEXT NOT NULL, position INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── PRODUCT OPTION VALUES ─────────────────────────────────
    `CREATE TABLE IF NOT EXISTS product_option_values (
      id TEXT PRIMARY KEY, option_id TEXT NOT NULL,
      value TEXT NOT NULL, position INTEGER DEFAULT 1
    )`,
    // ── PRODUCT VARIANTS ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, store_id TEXT NOT NULL,
      title TEXT NOT NULL,
      option1 TEXT, option2 TEXT, option3 TEXT,
      price REAL NOT NULL DEFAULT 0,
      compare_price REAL,
      cost_per_item REAL,
      sku TEXT, barcode TEXT,
      quantity INTEGER DEFAULT 0,
      track_qty INTEGER DEFAULT 1,
      continue_selling INTEGER DEFAULT 0,
      weight REAL DEFAULT 0, weight_unit TEXT DEFAULT 'kg',
      image_id TEXT,
      taxable INTEGER DEFAULT 1,
      requires_shipping INTEGER DEFAULT 1,
      position INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── INVENTORY MOVEMENTS ───────────────────────────────────
    `CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
      variant_id TEXT,
      store_id TEXT NOT NULL,
      adjustment INTEGER NOT NULL,
      quantity_after INTEGER NOT NULL,
      reason TEXT DEFAULT 'manual',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── CUSTOMERS ─────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      email TEXT NOT NULL, first_name TEXT, last_name TEXT, phone TEXT,
      city TEXT, country TEXT, address TEXT, zip TEXT,
      notes TEXT, tags TEXT,
      accepts_marketing INTEGER DEFAULT 0,
      tax_exempt INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0, orders_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── ORDERS ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_id TEXT,
      order_number INTEGER NOT NULL,
      status TEXT DEFAULT 'open',
      payment_status TEXT DEFAULT 'pending',
      fulfillment_status TEXT DEFAULT 'unfulfilled',
      financial_status TEXT DEFAULT 'pending',
      subtotal REAL DEFAULT 0, shipping REAL DEFAULT 0,
      tax REAL DEFAULT 0, discount_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      discount_code TEXT,
      source TEXT DEFAULT 'online_store',
      shipping_name TEXT, shipping_addr TEXT,
      shipping_city TEXT, shipping_zip TEXT,
      shipping_country TEXT, shipping_phone TEXT,
      billing_name TEXT, billing_addr TEXT,
      billing_city TEXT, billing_zip TEXT, billing_country TEXT,
      customer_email TEXT,
      notes TEXT, tags TEXT,
      cancel_reason TEXT, cancelled_at DATETIME,
      closed_at DATETIME,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── ORDER ITEMS ───────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
      product_id TEXT, variant_id TEXT,
      title TEXT NOT NULL, variant_title TEXT,
      sku TEXT, price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_discount REAL DEFAULT 0,
      taxable INTEGER DEFAULT 1,
      requires_shipping INTEGER DEFAULT 1,
      fulfillment_status TEXT DEFAULT 'unfulfilled'
    )`,
    // ── ORDER EVENTS (timeline) ────────────────────────────────
    `CREATE TABLE IF NOT EXISTS order_events (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── FULFILLMENTS ──────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS fulfillments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, store_id TEXT NOT NULL,
      status TEXT DEFAULT 'fulfilled',
      tracking_number TEXT, tracking_company TEXT, tracking_url TEXT,
      items TEXT DEFAULT '[]',
      notify_customer INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── REFUNDS ───────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, store_id TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      reason TEXT, note TEXT,
      restock INTEGER DEFAULT 0,
      items TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── COLLECTIONS ───────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL,
      description TEXT, image TEXT,
      status TEXT DEFAULT 'active',
      sort_order TEXT DEFAULT 'manual',
      seo_title TEXT, seo_description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── PRODUCT COLLECTIONS ───────────────────────────────────
    `CREATE TABLE IF NOT EXISTS product_collections (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
      collection_id TEXT NOT NULL, position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── DISCOUNTS ─────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS discounts (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      code TEXT NOT NULL, title TEXT,
      type TEXT DEFAULT 'percentage',
      value REAL DEFAULT 0,
      method TEXT DEFAULT 'code',
      applies_to TEXT DEFAULT 'all',
      min_order_amount REAL, min_quantity INTEGER,
      usage_limit INTEGER, usage_count INTEGER DEFAULT 0,
      once_per_customer INTEGER DEFAULT 0,
      starts_at DATETIME, ends_at DATETIME,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── PAGES ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS store_pages (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      title TEXT NOT NULL, slug TEXT NOT NULL,
      content TEXT, seo_title TEXT, seo_description TEXT,
      status TEXT DEFAULT 'published',
      template TEXT DEFAULT 'page',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── MENUS ─────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS menus (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      name TEXT NOT NULL, handle TEXT NOT NULL,
      items TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── ABANDONED CHECKOUTS ───────────────────────────────────
    `CREATE TABLE IF NOT EXISTS abandoned_checkouts (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      customer_email TEXT, customer_name TEXT, customer_phone TEXT,
      cart_items TEXT DEFAULT '[]',
      subtotal REAL DEFAULT 0,
      total_value REAL DEFAULT 0,
      discount_code TEXT,
      shipping_address TEXT,
      status TEXT DEFAULT 'open',
      recovered_at DATETIME,
      recovery_email_sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── SESSIONS ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL, expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── REDIRECTS ─────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS redirects (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      from_path TEXT NOT NULL, to_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── THEME SETTINGS ────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS theme_settings (
      id TEXT PRIMARY KEY, store_id TEXT UNIQUE NOT NULL,
      settings TEXT DEFAULT '{}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── ANALYTICS EVENTS ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page TEXT, referrer TEXT, utm_source TEXT,
      utm_medium TEXT, utm_campaign TEXT,
      session_id TEXT, ip TEXT,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  for (const sql of statements) {
    await db.execute(sql);
  }

  // Safe migrations — add columns to existing tables
  const migrations = [
    // products
    `ALTER TABLE products ADD COLUMN body_html TEXT`,
    `ALTER TABLE products ADD COLUMN cost_per_item REAL`,
    `ALTER TABLE products ADD COLUMN barcode TEXT`,
    `ALTER TABLE products ADD COLUMN continue_selling INTEGER DEFAULT 0`,
    `ALTER TABLE products ADD COLUMN weight_unit TEXT DEFAULT 'kg'`,
    `ALTER TABLE products ADD COLUMN product_type TEXT`,
    `ALTER TABLE products ADD COLUMN has_variants INTEGER DEFAULT 0`,
    `ALTER TABLE products ADD COLUMN seo_title TEXT`,
    `ALTER TABLE products ADD COLUMN seo_description TEXT`,
    `ALTER TABLE products ADD COLUMN seo_handle TEXT`,
    `ALTER TABLE products ADD COLUMN taxable INTEGER DEFAULT 1`,
    `ALTER TABLE products ADD COLUMN published_at DATETIME`,
    // stores
    `ALTER TABLE stores ADD COLUMN favicon_url TEXT`,
    `ALTER TABLE stores ADD COLUMN tax_rate REAL DEFAULT 0`,
    `ALTER TABLE stores ADD COLUMN tax_included INTEGER DEFAULT 0`,
    `ALTER TABLE stores ADD COLUMN tax_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE stores ADD COLUMN announcement_bar TEXT`,
    `ALTER TABLE stores ADD COLUMN announcement_bar_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE stores ADD COLUMN primary_color TEXT DEFAULT '#1a1a1a'`,
    `ALTER TABLE stores ADD COLUMN accent_color TEXT DEFAULT '#008060'`,
    `ALTER TABLE stores ADD COLUMN theme_settings TEXT DEFAULT '{}'`,
    // orders
    `ALTER TABLE orders ADD COLUMN customer_email TEXT`,
    `ALTER TABLE orders ADD COLUMN notes TEXT`,
    `ALTER TABLE orders ADD COLUMN tags TEXT`,
    `ALTER TABLE orders ADD COLUMN discount_code TEXT`,
    `ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0`,
    `ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'online_store'`,
    `ALTER TABLE orders ADD COLUMN financial_status TEXT DEFAULT 'pending'`,
    `ALTER TABLE orders ADD COLUMN cancel_reason TEXT`,
    `ALTER TABLE orders ADD COLUMN cancelled_at DATETIME`,
    `ALTER TABLE orders ADD COLUMN closed_at DATETIME`,
    `ALTER TABLE orders ADD COLUMN processed_at DATETIME`,
    `ALTER TABLE orders ADD COLUMN shipping_zip TEXT`,
    `ALTER TABLE orders ADD COLUMN shipping_phone TEXT`,
    `ALTER TABLE orders ADD COLUMN billing_name TEXT`,
    `ALTER TABLE orders ADD COLUMN billing_addr TEXT`,
    `ALTER TABLE orders ADD COLUMN billing_city TEXT`,
    `ALTER TABLE orders ADD COLUMN billing_zip TEXT`,
    `ALTER TABLE orders ADD COLUMN billing_country TEXT`,
    // order_items
    `ALTER TABLE order_items ADD COLUMN variant_id TEXT`,
    `ALTER TABLE order_items ADD COLUMN variant_title TEXT`,
    `ALTER TABLE order_items ADD COLUMN sku TEXT`,
    `ALTER TABLE order_items ADD COLUMN total_discount REAL DEFAULT 0`,
    `ALTER TABLE order_items ADD COLUMN taxable INTEGER DEFAULT 1`,
    `ALTER TABLE order_items ADD COLUMN requires_shipping INTEGER DEFAULT 1`,
    `ALTER TABLE order_items ADD COLUMN fulfillment_status TEXT DEFAULT 'unfulfilled'`,
    // customers
    `ALTER TABLE customers ADD COLUMN address TEXT`,
    `ALTER TABLE customers ADD COLUMN zip TEXT`,
    `ALTER TABLE customers ADD COLUMN tags TEXT`,
    `ALTER TABLE customers ADD COLUMN accepts_marketing INTEGER DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN tax_exempt INTEGER DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN total_spent REAL DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN orders_count INTEGER DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    // collections
    `ALTER TABLE collections ADD COLUMN image TEXT`,
    `ALTER TABLE collections ADD COLUMN status TEXT DEFAULT 'active'`,
    `ALTER TABLE collections ADD COLUMN sort_order TEXT DEFAULT 'manual'`,
    `ALTER TABLE collections ADD COLUMN seo_title TEXT`,
    `ALTER TABLE collections ADD COLUMN seo_description TEXT`,
    `ALTER TABLE collections ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    // discounts
    `ALTER TABLE discounts ADD COLUMN title TEXT`,
    `ALTER TABLE discounts ADD COLUMN method TEXT DEFAULT 'code'`,
    `ALTER TABLE discounts ADD COLUMN applies_to TEXT DEFAULT 'all'`,
    `ALTER TABLE discounts ADD COLUMN min_quantity INTEGER`,
    `ALTER TABLE discounts ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
  ];

  for (const sql of migrations) {
    try { await db.execute(sql); } catch(e) { /* column already exists */ }
  }

  // ── INDEXES ──────────────────────────────────────────────────────────────
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_products_store_status ON products(store_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_products_store_created ON products(store_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_variants_store ON product_variants(store_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_store_status ON orders(store_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(store_id, order_number)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(store_id, email)`,
    `CREATE INDEX IF NOT EXISTS idx_collections_store ON collections(store_id)`,
    `CREATE INDEX IF NOT EXISTS idx_product_collections_coll ON product_collections(collection_id)`,
    `CREATE INDEX IF NOT EXISTS idx_product_collections_prod ON product_collections(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_discounts_store ON discounts(store_id, code)`,
    `CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_movements(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_store ON analytics_events(store_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_fulfillments_order ON fulfillments(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stores_slug ON stores(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_blog_store ON blog_posts(store_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_menus_store ON menus(store_id, handle)`,
  ];

  for (const sql of indexes) {
    try { await db.execute(sql); } catch(e) { /* index may already exist */ }
  }

  console.log('✅ Database tables + indexes ready');
}

module.exports = { getDB };
