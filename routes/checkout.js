const express = require('express');
const router = express.Router();
const { getDB } = require('../db/database');

// ── STRIPE SETUP ─────────────────────────────────────────────────────────────
let stripe = null;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_PK = process.env.STRIPE_PUBLISHABLE_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;

if (STRIPE_SECRET) {
  try {
    stripe = require('stripe')(STRIPE_SECRET);
    console.log('✅ Stripe initialized');
  } catch (e) {
    console.warn('⚠️  Stripe package not installed. Run: npm install stripe');
  }
}

// ── CONFIG ENDPOINT ──────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({
    configured: !!(stripe && STRIPE_PK),
    publishableKey: STRIPE_PK || null,
  });
});

// ── CREATE PAYMENT INTENT ────────────────────────────────────────────────────
router.post('/create-intent', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

  try {
    const { amount, currency = 'usd', orderId, metadata = {} } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'Minimum charge is $0.50' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: {
        order_id: orderId || '',
        order_number: metadata.order_number || '',
        email: metadata.email || '',
      },
    });

    res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
    });
  } catch (e) {
    console.error('Stripe create-intent error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── WEBHOOK ──────────────────────────────────────────────────────────────────
// Stripe Dashboard → Developers → Webhooks
// URL: https://sivra-production.up.railway.app/api/checkout/webhook
// Events: payment_intent.succeeded, payment_intent.payment_failed
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');

  let event;

  if (WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (e) {
      console.error('⚠️  Webhook signature failed:', e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }
  } else {
    try {
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
      return res.status(400).send('Invalid payload');
    }
  }

  try {
    const db = getDB();

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const orderId = pi.metadata?.order_id;
        const orderNumber = pi.metadata?.order_number;
        console.log(`✅ Payment succeeded for order ${orderNumber || orderId} — $${(pi.amount / 100).toFixed(2)}`);

        if (orderId) {
          try {
            await db.execute({
              sql: `UPDATE orders SET payment_status = 'paid', financial_status = 'paid', status = 'confirmed' WHERE id = ?`,
              args: [orderId],
            });
            console.log(`  → Order ${orderId} marked as paid`);

            // Send confirmation email
            try {
              const email = require('../email');
              const orderRes = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [orderId] });
              if (orderRes.rows[0]) {
                const order = orderRes.rows[0];
                const customerEmail = order.customer_email || pi.metadata?.email;
                if (customerEmail) {
                  await email.sendOrderConfirmation({
                    to: customerEmail,
                    orderNumber: order.order_number || orderNumber,
                    total: (pi.amount / 100).toFixed(2),
                    items: JSON.parse(order.items || '[]'),
                  });
                  console.log(`  → Confirmation email sent to ${customerEmail}`);
                }
              }
            } catch (emailErr) {
              console.warn('  → Email send failed:', emailErr.message);
            }
          } catch (dbErr) {
            console.error('  → DB update failed:', dbErr.message);
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const orderId = pi.metadata?.order_id;
        console.log(`❌ Payment failed for order ${pi.metadata?.order_number || orderId}: ${pi.last_payment_error?.message || 'unknown'}`);

        if (orderId) {
          try {
            await db.execute({
              sql: `UPDATE orders SET payment_status = 'failed', financial_status = 'failed' WHERE id = ?`,
              args: [orderId],
            });
          } catch (e) {
            console.error('  → DB update failed:', e.message);
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error('Webhook handler error:', e.message);
  }

  res.json({ received: true });
});

module.exports = router;
