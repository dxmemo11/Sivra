// routes/customers.js
const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { search, sort = 'newest', page = 1, limit = 50 } = req.query;
    let sql = 'SELECT * FROM customers WHERE store_id = ?';
    const args = [req.storeId];
    if (search) {
      sql += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const sortMap = {
      newest: 'created_at DESC', oldest: 'created_at ASC',
      'spent-desc': 'total_spent DESC', 'orders-desc': 'orders_count DESC',
    };
    sql += ` ORDER BY ${sortMap[sort]||'created_at DESC'} LIMIT ? OFFSET ?`;
    args.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
    const result = await db.execute({ sql, args });
    const countResult = await db.execute({ sql:'SELECT COUNT(*) as total FROM customers WHERE store_id=?', args:[req.storeId] });
    res.json({ customers: result.rows, total: countResult.rows[0].total });
  } catch(err) { console.error(err); res.status(500).json({ error:'Failed to fetch customers.' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.execute({ sql:'SELECT * FROM customers WHERE id=? AND store_id=?', args:[req.params.id, req.storeId] });
    if (!result.rows.length) return res.status(404).json({ error:'Customer not found.' });
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error:'Failed to fetch customer.' }); }
});

router.post('/', async (req, res) => {
  try {
    const db = getDB();
    const { email, first_name, last_name, phone, address, city, zip, country, notes, tags, accepts_marketing } = req.body;
    if (!email) return res.status(400).json({ error:'Email is required.' });
    const id = uuid();
    await db.execute({
      sql:`INSERT INTO customers (id, store_id, email, first_name, last_name, phone, address, city, zip, country, notes, tags, accepts_marketing)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args:[id, req.storeId, email.toLowerCase(), first_name||null, last_name||null, phone||null,
        address||null, city||null, zip||null, country||null, notes||null, tags||null, accepts_marketing?1:0]
    });
    const created = await db.execute({ sql:'SELECT * FROM customers WHERE id=?', args:[id] });
    res.status(201).json(created.rows[0]);
  } catch(err) { res.status(500).json({ error:'Failed to create customer.' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { email, first_name, last_name, phone, address, city, zip, country, notes, tags, accepts_marketing, tax_exempt } = req.body;
    await db.execute({
      sql:`UPDATE customers SET
        email=COALESCE(?,email), first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name),
        phone=COALESCE(?,phone), address=COALESCE(?,address), city=COALESCE(?,city),
        zip=COALESCE(?,zip), country=COALESCE(?,country),
        notes=COALESCE(?,notes), tags=COALESCE(?,tags),
        accepts_marketing=COALESCE(?,accepts_marketing),
        tax_exempt=COALESCE(?,tax_exempt) WHERE id=? AND store_id=?`,
      args:[email||null, first_name!==undefined?first_name||null:null, last_name!==undefined?last_name||null:null,
        phone!==undefined?phone||null:null, address!==undefined?address||null:null,
        city!==undefined?city||null:null, zip!==undefined?zip||null:null, country!==undefined?country||null:null,
        notes!==undefined?notes||null:null, tags!==undefined?tags||null:null,
        accepts_marketing!==undefined?(accepts_marketing?1:0):null,
        tax_exempt!==undefined?(tax_exempt?1:0):null,
        req.params.id, req.storeId]
    });
    const updated = await db.execute({ sql:'SELECT * FROM customers WHERE id=?', args:[req.params.id] });
    res.json(updated.rows[0]);
  } catch(err) { res.status(500).json({ error:'Failed to update customer.' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    await db.execute({ sql:'DELETE FROM customers WHERE id=? AND store_id=?', args:[req.params.id, req.storeId] });
    res.json({ message:'Customer deleted.' });
  } catch(err) { res.status(500).json({ error:'Failed to delete customer.' }); }
});

module.exports = router;
