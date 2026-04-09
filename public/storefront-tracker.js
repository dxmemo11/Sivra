/* SIVRA Storefront Tracker — add before </body> on every storefront page */
(function() {
  var SLUG = localStorage.getItem('sivra_store_slug') || '';
  if (!SLUG) return;

  var SID = sessionStorage.getItem('sivra_sid');
  if (!SID) {
    SID = 'sid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('sivra_sid', SID);
  }

  function cart() {
    try {
      var c = JSON.parse(localStorage.getItem('sivra_cart') || '[]');
      return { items: c.reduce(function(s,i){return s+(i.qty||0)},0), value: c.reduce(function(s,i){return s+(parseFloat(i.price||0)*(i.qty||1))},0) };
    } catch(e) { return { items:0, value:0 }; }
  }

  function page() {
    var p = location.pathname;
    if (p.indexOf('storefront')!==-1) return 'home';
    if (p.indexOf('product')!==-1 && p.indexOf('products')===-1) return 'product';
    if (p.indexOf('collection')!==-1) return 'collection';
    if (p.indexOf('cart')!==-1) return 'cart';
    if (p.indexOf('checkout')!==-1) return 'checkout';
    if (p.indexOf('order-confirm')!==-1) return 'order_confirmed';
    if (p.indexOf('blog')!==-1) return 'blog';
    return 'other';
  }

  function send(url, data) {
    var json = JSON.stringify(data);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([json], {type:'application/json'}));
    } else {
      fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:json, keepalive:true}).catch(function(){});
    }
  }

  function utm() {
    var p = new URLSearchParams(location.search);
    return { utm_source:p.get('utm_source'), utm_medium:p.get('utm_medium'), utm_campaign:p.get('utm_campaign') };
  }

  function track() {
    var c = cart(), u = utm();
    send('/api/track/track', { storeSlug:SLUG, sessionId:SID, page:page(), referrer:document.referrer||null, utm_source:u.utm_source, utm_medium:u.utm_medium, utm_campaign:u.utm_campaign, cartItems:c.items, cartValue:c.value });
  }

  function heartbeat() {
    var c = cart();
    send('/api/track/heartbeat', { storeSlug:SLUG, sessionId:SID, page:page(), cartItems:c.items, cartValue:c.value });
  }

  window.sivraTrackEvent = function(type, data) {
    send('/api/track/event', { storeSlug:SLUG, sessionId:SID, eventType:type, data:data||null });
  };

  if (document.readyState==='complete') track(); else window.addEventListener('load', track);
  setInterval(heartbeat, 30000);
  window.addEventListener('beforeunload', heartbeat);
})();
