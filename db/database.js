// db/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './sivra.db';
let db;

function getDB() {
  if (!db) {
    db = new sqlite3.Database(path.resolve(DB_PATH), (err) => {
      if (err) console.error('DB connection error:', err);
      else console.log('✓ Connected to SQLite database');
    });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.serialize(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS merchants (
        id          TEXT PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        first_name  TEXT NOT NULL,
        last_name   TEXT NOT NULL,
        plan        TEXT DEFAULT 'starter',
        status      TEXT DEFAULT 'active',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stores (
        id          TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        slug        TEXT UNIQUE NOT NULL,
        description TEXT,
        category    TEXT,
        currency    TEXT DEFAULT 'USD',
        logo_url    TEXT,
        status      TEXT DEFAULT 'active',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id            TEXT PRIMARY KEY,
        store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        description   TEXT,
        price         REAL NOT NULL DEFAULT 0,
        compare_price REAL,
        sku           TEXT,
        quantity      INTEGER DEFAULT 0,
        track_qty     INTEGER DEFAULT 1,
        weight        REAL DEFAULT 0,
        category      TEXT,
        status        TEXT DEFAULT 'active',
        images        TEXT DEFAULT '[]',
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );

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

      CREATE TABLE IF NOT EXISTS orders (
        id              TEXT PRIMARY KEY,
        store_id        TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        customer_id     TEXT REFERENCES customers(id),
        order_number    INTEGER NOT NULL,
        status          TEXT DEFAULT 'pending',
        payment_status  TEXT DEFAULT 'unpaid',
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

      CREATE TABLE IF NOT EXISTS order_items (
        id          TEXT PRIMARY KEY,
        order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id  TEXT REFERENCES products(id),
        title       TEXT NOT NULL,
        price       REAL NOT NULL,
        quantity    INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS collections (
        id          TEXT PRIMARY KEY,
        store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        slug        TEXT NOT NULL,
        image_url   TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pages (
        id          TEXT PRIMARY KEY,
        store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        slug        TEXT NOT NULL,
        content     TEXT,
        status      TEXT DEFAULT 'published',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        token       TEXT UNIQUE NOT NULL,
        expires_at  DATETIME NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_stores_merchant   ON stores(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_products_store    ON products(store_id);
      CREATE INDEX IF NOT EXISTS idx_orders_store      ON orders(store_id);
      CREATE INDEX IF NOT EXISTS idx_orders_customer   ON orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_customers_store   ON customers(store_id);
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    `, (err) => {
      if (err) console.error('Table init error:', err);
      else console.log('✓ Database tables ready');
    });
  });
}

module.exports = { getDB };
