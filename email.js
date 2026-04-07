// routes/email.js — Email notifications via SMTP
// Supports: Gmail, SendGrid, Resend, any SMTP
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// ── EMAIL SENDER ──────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  // Check which email provider is configured
  const provider = process.env.EMAIL_PROVIDER || 'smtp';
  
  if (provider === 'resend' && process.env.RESEND_API_KEY) {
    return sendViaResend({ to, subject, html });
  }
  if (provider === 'sendgrid' && process.env.SENDGRID_API_KEY) {
    return sendViaSendGrid({ to, subject, html });
  }
  if (process.env.SMTP_HOST) {
    return sendViaSMTP({ to, subject, html, text });
  }
  // No email configured — log to console in dev
  console.log(`📧 [EMAIL - not configured] To: ${to} | Subject: ${subject}`);
  return { success: false, reason: 'no_email_provider' };
}

async function sendViaResend({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'orders@yourdomain.com',
      to, subject, html,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Resend API error');
  return { success: true, id: data.id };
}

async function sendViaSendGrid({ to, subject, html }) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM || 'orders@yourdomain.com' },
      subject, content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.errors?.[0]?.message || 'SendGrid error');
  }
  return { success: true };
}

async function sendViaSMTP({ to, subject, html, text }) {
  // Use nodemailer if available, otherwise use fetch to a relay
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to, subject, html, text,
    });
    return { success: true };
  } catch(e) {
    console.error('SMTP error:', e.message);
    return { success: false, error: e.message };
  }
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────────────────────
function orderConfirmationEmail({ order, storeName, storeUrl, items }) {
  const itemRows = (items || []).map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f0f0f0">
        <strong>${item.title}</strong>${item.variant_title ? ` — ${item.variant_title}` : ''}
        <div style="font-size:12px;color:#6d7175">Qty: ${item.quantity}</div>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">
        $${(parseFloat(item.price||0) * parseInt(item.quantity||1)).toFixed(2)}
      </td>
    </tr>`).join('');

  return {
    subject: `Order confirmed — #${order.order_number} from ${storeName}`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif">
  <div style="max-width:600px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e3e3e3">
    <!-- Header -->
    <div style="background:#1a1a1a;padding:28px 32px">
      <div style="font-size:22px;font-weight:700;color:white">${storeName}</div>
    </div>
    <!-- Body -->
    <div style="padding:32px">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 6px">Order confirmed! 🎉</h1>
      <p style="color:#6d7175;font-size:14px;margin:0 0 24px">Hi ${order.shipping_name||'there'}, your order has been received and is being processed.</p>
      
      <div style="background:#f9f9f9;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:13px;color:#6d7175;margin-bottom:4px">Order number</div>
        <div style="font-size:18px;font-weight:700;color:#1a1a1a">#${order.order_number}</div>
      </div>

      <h3 style="font-size:14px;font-weight:600;margin:0 0 12px;color:#1a1a1a">Order summary</h3>
      <table style="width:100%;border-collapse:collapse">
        ${itemRows}
      </table>

      <div style="margin-top:16px;padding-top:16px;border-top:2px solid #e3e3e3">
        ${order.discount_amount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:#6d7175">Discount</span><span style="color:#1a7f37">-$${parseFloat(order.discount_amount).toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:#6d7175">Subtotal</span><span>$${parseFloat(order.subtotal||0).toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span style="color:#6d7175">Shipping</span><span>$${parseFloat(order.shipping||0).toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:12px"><span style="color:#6d7175">Tax</span><span>$${parseFloat(order.tax||0).toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700"><span>Total</span><span>$${parseFloat(order.total||0).toFixed(2)}</span></div>
      </div>

      ${order.shipping_addr ? `
      <h3 style="font-size:14px;font-weight:600;margin:24px 0 8px;color:#1a1a1a">Shipping address</h3>
      <div style="font-size:13px;color:#4a4a4a;line-height:1.8">
        ${order.shipping_name||''}<br/>
        ${order.shipping_addr||''}<br/>
        ${[order.shipping_city, order.shipping_zip, order.shipping_country].filter(Boolean).join(', ')}
      </div>` : ''}

      <div style="margin-top:28px;padding:16px 20px;background:#f0faf0;border-radius:8px;border:1px solid #b7e2c4">
        <div style="font-size:13px;font-weight:600;color:#1a7f37;margin-bottom:4px">What happens next?</div>
        <div style="font-size:13px;color:#4a4a4a">We'll process your order and send you shipping confirmation with tracking details once dispatched.</div>
      </div>

      <div style="margin-top:24px;text-align:center">
        <a href="${storeUrl}" style="display:inline-block;padding:12px 28px;background:#1a1a1a;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Continue shopping</a>
      </div>
    </div>
    <!-- Footer -->
    <div style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #e3e3e3">
      <div style="font-size:12px;color:#8c9196">© ${new Date().getFullYear()} ${storeName} · Powered by Sivra</div>
    </div>
  </div>
</body>
</html>`
  };
}

function newOrderAdminEmail({ order, storeName, adminUrl, items }) {
  const itemLines = (items||[]).map(i => `• ${i.title}${i.variant_title?` (${i.variant_title})`:''} × ${i.quantity} — $${parseFloat(i.price||0).toFixed(2)}`).join('\n');
  return {
    subject: `New order #${order.order_number} — $${parseFloat(order.total||0).toFixed(2)}`,
    html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif">
  <div style="max-width:600px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e3e3e3">
    <div style="background:#1a1a1a;padding:20px 32px;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:18px;font-weight:700;color:white">${storeName}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.6)">New order</div>
    </div>
    <div style="padding:28px 32px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <div style="width:48px;height:48px;background:#f0faf0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px">💰</div>
        <div>
          <div style="font-size:20px;font-weight:700">Order #${order.order_number}</div>
          <div style="font-size:13px;color:#6d7175">$${parseFloat(order.total||0).toFixed(2)} · ${order.customer_email||'Guest'}</div>
        </div>
      </div>
      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:20px;font-size:13px;color:#4a4a4a;white-space:pre-line">${itemLines}</div>
      <a href="${adminUrl}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">View order in admin →</a>
    </div>
  </div>
</body></html>`
  };
}

function shippingConfirmationEmail({ order, storeName, trackingNumber, trackingCompany, trackingUrl }) {
  return {
    subject: `Your order #${order.order_number} has shipped! 🚚`,
    html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif">
  <div style="max-width:600px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e3e3e3">
    <div style="background:#1a1a1a;padding:28px 32px">
      <div style="font-size:22px;font-weight:700;color:white">${storeName}</div>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 8px">Your order is on its way! 🚚</h1>
      <p style="color:#6d7175;font-size:14px;margin:0 0 24px">Hi ${order.shipping_name||'there'}, your order #${order.order_number} has been shipped.</p>
      ${trackingNumber ? `
      <div style="background:#f9f9f9;border-radius:8px;padding:20px;margin-bottom:24px;text-align:center">
        <div style="font-size:12px;color:#6d7175;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">${trackingCompany||'Tracking'} number</div>
        <div style="font-size:20px;font-weight:700;font-family:monospace;letter-spacing:2px;color:#1a1a1a">${trackingNumber}</div>
        ${trackingUrl ? `<a href="${trackingUrl}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#1a1a1a;color:white;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600">Track your package →</a>` : ''}
      </div>` : ''}
      <div style="font-size:13px;color:#6d7175">Expected delivery: 3–7 business days</div>
    </div>
    <div style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #e3e3e3">
      <div style="font-size:12px;color:#8c9196">© ${new Date().getFullYear()} ${storeName}</div>
    </div>
  </div>
</body></html>`
  };
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
module.exports = {
  sendEmail,
  orderConfirmationEmail,
  newOrderAdminEmail,
  shippingConfirmationEmail,
};
