// routes/checkout.js — Stripe payment integration
const express = require('express');
const router = express.Router();

// Gracefully handle missing Stripe key
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// POST /api/checkout/create-intent
// Called by the storefront checkout page to create a Stripe PaymentIntent
router.post('/create-intent', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: 'Payments not configured. Set STRIPE_SECRET_KEY in environment.' });
    }

    const { amount, currency = 'usd', metadata = {}, orderId } = req.body;
    if (!amount || amount < 50) return res.status(400).json({ error: 'Amount must be at least $0.50' });

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount),   // amount in cents
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: {
        ...metadata,
        order_id: orderId || '',
        platform: 'sivra',
      }
    });

    res.json({
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
    });
  } catch (err) {
    console.error('Stripe create-intent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/checkout/config
// Returns the publishable key so the frontend can initialize Stripe.js
router.get('/config', (req, res) => {
  const pk = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!pk) {
    return res.json({ configured: false });
  }
  res.json({
    configured: true,
    publishableKey: pk,
  });
});

// POST /api/checkout/webhook — Stripe webhook (raw body parsed in server.js)
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — webhook verification skipped');
    return res.json({ received: true });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle payment success
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const orderId = pi.metadata?.order_id;
    console.log('✅ PaymentIntent succeeded:', pi.id, 'Order:', orderId);

    if (orderId) {
      try {
        const { getDB } = require('../db/database');
        const db = getDB();
        await db.execute({
          sql: `UPDATE orders SET payment_status='paid', financial_status='paid', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          args: [orderId]
        });
        // Log event
        const { v4: uuid } = require('uuid');
        await db.execute({
          sql: `INSERT INTO order_events (id, order_id, event_type, message, data) VALUES (?,?,?,?,?)`,
          args: [uuid(), orderId, 'payment_received',
            `Payment of $${(pi.amount / 100).toFixed(2)} received via Stripe`,
            JSON.stringify({ payment_intent: pi.id, amount: pi.amount })]
        });
      } catch(dbErr) {
        console.error('Failed to update order after payment:', dbErr.message);
      }
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    console.warn('❌ Payment failed:', pi.id, pi.last_payment_error?.message);
  }

  res.json({ received: true });
});

module.exports = router;
