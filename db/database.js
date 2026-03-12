// db/database.js
// Sets up the SQLite database and creates all tables on first run

const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './sivra.db';

let db;

function getDB() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma('journal_mode = WAL'); // faster writes
    db.pragma('foreign_keys = ON');  // enforce relationships
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`

    -- ── MERCHANTS (store owners who pay you) ──────────────────────
    CREATE TABLE IF NOT EXISTS merchants (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      first_name  TEXT NOT NULL,
      last_name   TEXT NOT NULL,
      plan        TEXT DEFAULT 'starter',   -- starter | growth | pro
      status      TEXT DEFAULT 'active',    -- active | suspended | cancelled
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── STORES (each merchant can have 1+ stores) ──────────────────
    CREATE TABLE IF NOT EXISTS stores (
      id          TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,     -- sarahs-boutique (used in URL)
      description TEXT,
      category    TEXT,
      currency    TEXT DEFAULT 'USD',
      logo_url    TEXT,
      status      TEXT DEFAULT 'active',   -- active | inactive
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── PRODUCTS ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id            TEXT PRIMARY KEY,
      store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      description   TEXT,
      price         REAL NOT NULL DEFAULT 0,
      compare_price REAL,                  -- crossed-out "was" price
      sku           TEXT,
      quantity      INTEGER DEFAULT 0,
      track_qty     INTEGER DEFAULT 1,     -- 1=track, 0=unlimited
      weight        REAL DEFAULT 0,
      category      TEXT,
      status        TEXT DEFAULT 'active', -- active | draft | archived
      images        TEXT DEFAULT '[]',     -- JSON array of image URLs
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── CUSTOMERS (shoppers who buy from a store) ──────────────────
    CREATE TABLE IF NOT EXISTS customers (
      id         TEXT PRIMARY KEY,
      store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      email      TEXT NOT NULL,
      first_name TEXT,
      last_name  TEXT,
      phone      TEXT,
      city       TEXT,
      country    TEXT,
      notes      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store_id, email)
    );

    -- ── ORDERS ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id              TEXT PRIMARY KEY,
      store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      customer_id     TEXT REFERENCES customers(id),
      order_number    INTEGER NOT NULL,
      status          TEXT DEFAULT 'pending',   -- pending | processing | fulfilled | cancelled | refunded
      payment_status  TEXT DEFAULT 'unpaid',    -- unpaid | paid | refunded
      subtotal        REAL DEFAULT 0,
      shipping        REAL DEFAULT 0,
      tax             REAL DEFAULT 0,
      total           REAL DEFAULT 0,
      shipping_name   TEXT,
      shipping_addr   TEXT,
      shipping_city   TEXT,
      shipping_country TEXT,
      notes           TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── ORDER ITEMS ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS order_items (
      id          TEXT PRIMARY KEY,
      order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id  TEXT REFERENCES products(id),
      title       TEXT NOT NULL,           -- snapshot of product name at time of order
      price       REAL NOT NULL,           -- snapshot of price at time of order
      quantity    INTEGER NOT NULL DEFAULT 1
    );

    -- ── COLLECTIONS (product groups) ──────────────────────────────
    CREATE TABLE IF NOT EXISTS collections (
      id          TEXT PRIMARY KEY,
      store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      slug        TEXT NOT NULL,
      image_url   TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── PAGES (about, contact, faq etc.) ──────────────────────────
    CREATE TABLE IF NOT EXISTS pages (
      id          TEXT PRIMARY KEY,
      store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      slug        TEXT NOT NULL,
      content     TEXT,
      status      TEXT DEFAULT 'published',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── SESSIONS (for auth) ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      token       TEXT UNIQUE NOT NULL,
      expires_at  DATETIME NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── INDEXES for fast queries ───────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_stores_merchant    ON stores(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_products_store     ON products(store_id);
    CREATE INDEX IF NOT EXISTS idx_orders_store       ON orders(store_id);
    CREATE INDEX IF NOT EXISTS idx_orders_customer    ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customers_store    ON customers(store_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);

  `);

  console.log('✓ Database tables ready');
}

module.exports = { getDB };
