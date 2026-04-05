// db/database.js
const { createClient } = require('@libsql/client');
const path = require('path');
require('dotenv').config();

let db;

function getDB() {
  if (!db) {
    let url, authToken;

    if (process.env.TURSO_DATABASE_URL) {
      // Production: Turso cloud database (data persists forever)
      url = process.env.TURSO_DATABASE_URL;
      authToken = process.env.TURSO_AUTH_TOKEN;
    } else if (process.env.DB_PATH) {
      // Fallback: local file
      url = process.env.DB_PATH.startsWith('file:')
        ? process.env.DB_PATH
        : `file:${process.env.DB_PATH}`;
    } else {
      // Default local file for development
      url = `file:${path.join(__dirname, '../sivra.db')}`;
    }

    db = createClient({ url, authToken });
    initTables();
  }
  return db;
}

async function initTables() {
  try {
    const statements = [
      `CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
        first_name TEXT NOT NULL, last_name TEXT NOT NULL, plan TEXT DEFAULT 'starter',
        status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS stores (
        id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL, description TEXT, category TEXT,
        currency TEXT DEFAULT 'USD', logo_url TEXT, status TEXT DEFAULT 'active',
        shipping_zones TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, price REAL NOT NULL DEFAULT 0,
        compare_price REAL, sku TEXT, quantity INTEGER NOT NULL DEFAULT 0,
        track_qty INTEGER DEFAULT 1, weight REAL DEFAULT 0, category TEXT,
        status TEXT DEFAULT 'active', images TEXT DEFAULT '[]', vendor TEXT, tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, email TEXT NOT NULL,
        first_name TEXT, last_name TEXT, phone TEXT, city TEXT, country TEXT,
        notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, customer_id TEXT,
        order_number INTEGER NOT NULL, status TEXT DEFAULT 'pending',
        payment_status TEXT DEFAULT 'unpaid', fulfillment_status TEXT DEFAULT 'unfulfilled',
        subtotal REAL DEFAULT 0, shipping REAL DEFAULT 0, tax REAL DEFAULT 0,
        total REAL DEFAULT 0, shipping_name TEXT, shipping_addr TEXT,
        shipping_city TEXT, shipping_country TEXT, notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT,
        title TEXT NOT NULL, price REAL NOT NULL, quantity INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL,
        slug TEXT NOT NULL, description TEXT, image_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, title TEXT NOT NULL,
        slug TEXT NOT NULL, content TEXT, status TEXT DEFAULT 'published',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ];

    for (const sql of statements) {
      await db.execute(sql);
    }

    // Add missing columns to existing tables (safe migrations)
    const migrations = [
      `ALTER TABLE stores ADD COLUMN shipping_zones TEXT DEFAULT '[]'`,
      `ALTER TABLE products ADD COLUMN vendor TEXT`,
      `ALTER TABLE products ADD COLUMN tags TEXT`,
      `ALTER TABLE orders ADD COLUMN fulfillment_status TEXT DEFAULT 'unfulfilled'`,
      `ALTER TABLE orders ADD COLUMN notes TEXT`,
    ];

    for (const sql of migrations) {
      try { await db.execute(sql); } catch(e) { /* column already exists */ }
    }

    console.log('Database tables ready');
  } catch (err) {
    console.error('Table init error:', err);
  }
}

module.exports = { getDB };
