/* ═══════════════════════════════════════════════
   SIVRA — Storefront Analytics Tracker
   Add to every customer-facing page before </body>:
   <script src="storefront-tracker.js"></script>
   ═══════════════════════════════════════════════ */
(function() {
  const STORE_SLUG = localStorage.getItem('sivra_store_slug') || '';
  if (!STORE_SLUG) return;

  // Get or create session ID (persists across page views, expires with browser)
  let SESSION_ID = sessionStorage.getItem('sivra_sid');
  if (!SESSION_ID) {
    SESSION_ID = 'sid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('sivra_sid', SESSION_ID);
  }

  // Get cart info for behavioral data
  function getCartInfo() {
    try {
      const cart = JSON.parse(localStorage.getItem('sivra_cart') || '[]');
      return {
        cartItems: cart.reduce((s, i) => s + (i.qty || 0), 0),
        cartValue: cart.reduce((s, i) => s + (parseFloat(i.price || 0) * (i.qty || 1)), 0),
      };
    } catch(e) { return { cartItems: 0, cartValue: 0 }; }
  }

  // Get UTM params
  function getUTM() {
    const p = new URLSearchParams(location.search);
    return {
      utm_source: p.get('utm_source') || null,
      utm_medium: p.get('utm_medium') || null,
      utm_campaign: p.get('utm_campaign') || null,
    };
  }

  // Determine current page type
  function getPageType() {
    const path = location.pathname;
    if (path.includes('storefront')) return 'home';
    if (path.includes('product') && !path.includes('products')) return 'product';
    if (path.includes('collection')) return 'collection';
    if (path.includes('cart')) return 'cart';
    if (path.includes('checkout')) return 'checkout';
    if (path.includes('order-confirm')) return 'order_confirmed';
    if (path.includes('blog')) return 'blog';
    if (path.includes('policy')) return 'page';
    return 'other';
  }

  // Send tracking data (fire and forget, never blocks UI)
  function track() {
    const cart = getCartInfo();
    const utm = getUTM();
    const data = {
      storeSlug: STORE_SLUG,
      sessionId: SESSION_ID,
      page: getPageType(),
      referrer: document.referrer || null,
      ...utm,
      ...cart,
    };

    // Use sendBeacon for reliability (survives page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track/track', JSON.stringify(data));
    } else {
      fetch('/api/track/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(() => {});
    }
  }

  // Heartbeat every 30 seconds to keep session alive
  function heartbeat() {
    const cart = getCartInfo();
    const data = {
      storeSlug: STORE_SLUG,
      sessionId: SESSION_ID,
      page: getPageType(),
      ...cart,
    };
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track/heartbeat', JSON.stringify(data));
    } else {
      fetch('/api/track/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(() => {});
    }
  }

  // Track specific events (add to cart, checkout started, etc)
  window.sivraTrackEvent = function(eventType, eventData) {
    const data = {
      storeSlug: STORE_SLUG,
      sessionId: SESSION_ID,
      eventType,
      data: eventData || null,
    };
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track/event', JSON.stringify(data));
    } else {
      fetch('/api/track/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(() => {});
    }
  };

  // Init: track page view on load
  if (document.readyState === 'complete') {
    track();
  } else {
    window.addEventListener('load', track);
  }

  // Heartbeat every 30 seconds
  setInterval(heartbeat, 30000);

  // Track when user leaves
  window.addEventListener('beforeunload', () => {
    heartbeat();
  });
})();
