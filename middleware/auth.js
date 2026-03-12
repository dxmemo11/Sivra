// middleware/auth.js
// Protects routes — checks the JWT token before allowing access

const jwt = require('jsonwebtoken');
const { getDB } = require('../db/database');

function requireAuth(req, res, next) {
  // Token comes in the Authorization header: "Bearer <token>"
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Attach merchant info to every request so routes can use it
    req.merchantId = payload.merchantId;
    req.storeId = payload.storeId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

module.exports = { requireAuth };
