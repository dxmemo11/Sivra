// middleware/auth.js — JWT authentication middleware
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error.' });
    }

    const decoded = jwt.verify(token, secret);

    // Attach merchant and store IDs to request
    req.merchantId = decoded.merchantId;
    req.storeId = decoded.storeId;

    if (!req.merchantId) {
      return res.status(401).json({ error: 'Invalid token. Please sign in again.' });
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token. Please sign in again.' });
    }
    console.error('Auth middleware error:', err);
    return res.status(401).json({ error: 'Authentication failed.' });
  }
}

module.exports = { requireAuth };
