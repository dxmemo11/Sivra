// email.js — Email sending module for Sivra
// Supports: Resend (primary), SendGrid, Postmark

const PROVIDER = process.env.EMAIL_PROVIDER || '';
const FROM = process.env.EMAIL_FROM || 'noreply@sivra.store';

async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject) return { sent: false, reason: 'Missing to/subject' };

  if (PROVIDER === 'resend') {
    return sendViaResend({ to, subject, html, text });
  }
  if (PROVIDER === 'sendgrid') {
    return sendViaSendGrid({ to, subject, html, text });
  }

  console.warn('Email not sent — EMAIL_PROVIDER not configured. Set EMAIL_PROVIDER=resend in Railway env vars.');
  return { sent: false, reason: 'No email provider configured' };
}

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set');
    return { sent: false, reason: 'RESEND_API_KEY missing' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Resend error:', data);
      return { sent: false, reason: data.message || 'Resend API error' };
    }
    return { sent: true, id: data.id, provider: 'resend' };
  } catch(e) {
    console.error('Resend send error:', e.message);
    return { sent: false, reason: e.message };
  }
}

async function sendViaSendGrid({ to, subject, html, text }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return { sent: false, reason: 'SENDGRID_API_KEY missing' };
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM },
        subject,
        content: [
          html ? { type: 'text/html', value: html } : { type: 'text/plain', value: text || subject }
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('SendGrid error:', err);
      return { sent: false, reason: 'SendGrid error' };
    }
    return { sent: true, provider: 'sendgrid' };
  } catch(e) {
    return { sent: false, reason: e.message };
  }
}

function orderConfirmationEmail({ order, storeName, storeUrl, items }) {
  const itemRows = (items || []).map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
        <strong style="font-size:14px">${i.title}</strong>
        ${i.variant_title ? `<br><span style="color:#6d7175;font-size:13px">${i.variant_title}</span>` : ''}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:center;color:#6d7175">${i.quantity || 1}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">$${parseFloat(i.price || 0).toFixed(2)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1a1a1a;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:white;font-size:20px;font-weight:700;margin:0">${storeName}</h1>
      </div>
      <div style="padding:32px;border:1px solid #e3e3e3;border-top:none;border-radius:0 0 12px 12px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:36px;margin-bottom:8px">✅</div>
          <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Order confirmed!</h2>
          <p style="color:#6d7175;font-size:14px;margin:0">Order #${order.order_number}</p>
        </div>
        <p style="font-size:14px;line-height:1.6;color:#303030">
          Thank you for your order! We've received it and will begin processing it shortly.
        </p>
        <div style="background:#f9f9f9;border-radius:8px;padding:20px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr style="color:#6d7175;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">
              <td style="padding-bottom:10px">Item</td>
              <td style="padding-bottom:10px;text-align:center">Qty</td>
              <td style="padding-bottom:10px;text-align:right">Price</td>
            </tr>
            ${itemRows}
          </table>
          <div style="margin-top:16px;border-top:2px solid #e3e3e3;padding-top:12px;display:flex;justify-content:space-between">
            <span style="font-size:14px;font-weight:600">Total</span>
            <span style="font-size:18px;font-weight:700">$${parseFloat(order.total || 0).toFixed(2)}</span>
          </div>
        </div>
        ${order.shipping_name ? `
        <div style="margin-bottom:24px">
          <h3 style="font-size:13px;font-weight:600;color:#6d7175;text-transform:uppercase;margin:0 0 8px">Shipping to</h3>
          <p style="font-size:14px;color:#303030;line-height:1.6;margin:0">
            ${order.shipping_name}<br>
            ${order.shipping_addr || ''}${order.shipping_city ? ', ' + order.shipping_city : ''} ${order.shipping_zip || ''}<br>
            ${order.shipping_country || ''}
          </p>
        </div>` : ''}
        <div style="text-align:center;margin-top:24px">
          <a href="${storeUrl || '#'}" style="display:inline-block;background:#1a1a1a;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Continue shopping</a>
        </div>
        <p style="font-size:12px;color:#8c9196;text-align:center;margin-top:24px">
          Questions? Reply to this email or contact us at ${FROM}
        </p>
      </div>
    </div>`;

  return { subject: `Order confirmed — #${order.order_number}`, html };
}

function shippingConfirmationEmail({ order, storeName, storeUrl, trackingNumber, trackingUrl, carrier }) {
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1a1a1a;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:white;font-size:20px;font-weight:700;margin:0">${storeName}</h1>
      </div>
      <div style="padding:32px;border:1px solid #e3e3e3;border-top:none;border-radius:0 0 12px 12px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:36px;margin-bottom:8px">📦</div>
          <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Your order is on its way!</h2>
          <p style="color:#6d7175;font-size:14px;margin:0">Order #${order.order_number}</p>
        </div>
        ${trackingNumber ? `
        <div style="background:#f0faf0;border:1px solid #b7e2c4;border-radius:8px;padding:20px;margin:24px 0;text-align:center">
          <div style="font-size:12px;color:#6d7175;text-transform:uppercase;margin-bottom:8px">Tracking number</div>
          <div style="font-size:18px;font-weight:700;font-family:monospace;letter-spacing:1px">${trackingNumber}</div>
          ${carrier ? `<div style="font-size:13px;color:#6d7175;margin-top:4px">${carrier}</div>` : ''}
          ${trackingUrl ? `<a href="${trackingUrl}" style="display:inline-block;background:#1a7f37;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:12px">Track package →</a>` : ''}
        </div>` : ''}
        <div style="text-align:center"><a href="${storeUrl || '#'}" style="display:inline-block;background:#1a1a1a;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Visit store</a></div>
      </div>
    </div>`;

  return { subject: `Your order #${order.order_number} has shipped!`, html };
}

function newOrderAdminEmail({ order, storeName, adminUrl, items }) {
  const itemList = (items || []).map(i =>
    `• ${i.title}${i.variant_title ? ' (' + i.variant_title + ')' : ''} × ${i.quantity || 1} — $${parseFloat(i.price || 0).toFixed(2)}`
  ).join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1a1a1a;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="color:white;font-size:20px;font-weight:700;margin:0">🔔 New Order — ${storeName}</h1>
      </div>
      <div style="padding:32px;border:1px solid #e3e3e3;border-top:none;border-radius:0 0 12px 12px">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 16px">Order #${order.order_number}</h2>
        <table style="width:100%;font-size:14px;margin-bottom:16px">
          <tr><td style="padding:4px 0;color:#6d7175">Customer</td><td style="font-weight:500">${order.customer_email}</td></tr>
          <tr><td style="padding:4px 0;color:#6d7175">Total</td><td style="font-weight:700;font-size:18px">$${parseFloat(order.total || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:4px 0;color:#6d7175">Items</td><td>${(items || []).length} items</td></tr>
          ${order.shipping_name ? `<tr><td style="padding:4px 0;color:#6d7175">Ship to</td><td>${order.shipping_name}, ${order.shipping_city || ''} ${order.shipping_country || ''}</td></tr>` : ''}
        </table>
        <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin:16px 0;font-size:13px;white-space:pre-line;font-family:monospace">${itemList}</div>
        <a href="${adminUrl}" style="display:inline-block;background:#1a1a1a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View order →</a>
      </div>
    </div>`;

  return { subject: `💰 New order #${order.order_number} — $${parseFloat(order.total || 0).toFixed(2)}`, html };
}

module.exports = { sendEmail, orderConfirmationEmail, shippingConfirmationEmail, newOrderAdminEmail };
