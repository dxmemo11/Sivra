/* ═══════════════════════════════════════════════
   SIVRA STOREFRONT — Enhancement Scripts
   Size guide, sticky ATC, email popup, countdown,
   upsells, image zoom, stock urgency
   
   Include on product page and storefront:
   <link rel="stylesheet" href="storefront-enhancements.css"/>
   <script src="storefront-enhancements.js"></script>
   ═══════════════════════════════════════════════ */

// ── SIZE GUIDE ─────────────────────────────────────
(function() {
  // Jersey size chart data — customize for your products
  const SIZE_DATA = {
    default: {
      title: 'Jersey Size Guide',
      headers: ['Size', 'Chest (in)', 'Length (in)', 'Shoulder (in)'],
      rows: [
        ['S',  '36–38', '27', '17'],
        ['M',  '38–40', '28', '17.5'],
        ['L',  '40–42', '29', '18'],
        ['XL', '42–44', '30', '18.5'],
        ['2XL','44–46', '31', '19'],
        ['3XL','46–48', '32', '19.5'],
      ],
      tip: '📏 Measure your chest around the fullest part. For a looser fit, size up. For a tighter match-day fit, go true to size.'
    },
    kids: {
      title: 'Kids Size Guide',
      headers: ['Size', 'Age', 'Chest (in)', 'Length (in)'],
      rows: [
        ['YS', '6–8',  '26–28', '20'],
        ['YM', '8–10', '28–30', '22'],
        ['YL', '10–12','30–32', '24'],
        ['YXL','12–14','32–34', '26'],
      ],
      tip: '📏 Kids sizes run true to age. When in doubt, size up — they grow fast!'
    }
  };

  window.SizeGuide = {
    // Call this to inject the size guide button into the product page
    init(type = 'default') {
      const data = SIZE_DATA[type] || SIZE_DATA.default;
      
      // Create the modal HTML
      if (!document.getElementById('sizeGuideOverlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'sizeGuideOverlay';
        overlay.className = 'size-guide-overlay';
        overlay.onclick = function(e) { if (e.target === overlay) SizeGuide.close(); };
        overlay.innerHTML = `
          <div class="size-guide-modal">
            <div class="size-guide-header">
              <span class="size-guide-title" id="sizeGuideTitle">${data.title}</span>
              <button class="size-guide-close" onclick="SizeGuide.close()">×</button>
            </div>
            <div class="size-guide-body">
              <table class="size-table" id="sizeGuideTable">
                <thead><tr>${data.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${data.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
              <div class="size-tip" id="sizeGuideTip">${data.tip}</div>
            </div>
          </div>`;
        document.body.appendChild(overlay);
      }

      // Insert the "Size guide" link next to options
      const optionsSection = document.getElementById('optionsSection');
      if (optionsSection && !document.getElementById('sizeGuideLink')) {
        const link = document.createElement('div');
        link.id = 'sizeGuideLink';
        link.innerHTML = `<button onclick="SizeGuide.open()" style="background:none;border:none;color:#005bd3;font-size:13px;font-weight:500;cursor:pointer;padding:4px 0;display:flex;align-items:center;gap:4px;font-family:inherit;margin-top:-8px;margin-bottom:12px">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 5h12M1 9h12M3 1v12M11 1v12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Size guide
        </button>`;
        optionsSection.insertAdjacentElement('afterbegin', link);
      }
    },
    open() {
      const el = document.getElementById('sizeGuideOverlay');
      if (el) el.classList.add('open');
    },
    close() {
      const el = document.getElementById('sizeGuideOverlay');
      if (el) el.classList.remove('open');
    },
    // Update the chart data dynamically (e.g., for different product types)
    setData(data) {
      const table = document.getElementById('sizeGuideTable');
      const title = document.getElementById('sizeGuideTitle');
      const tip = document.getElementById('sizeGuideTip');
      if (title) title.textContent = data.title || 'Size Guide';
      if (tip) tip.textContent = data.tip || '';
      if (table) {
        table.innerHTML = `
          <thead><tr>${(data.headers||[]).map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${(data.rows||[]).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
      }
    }
  };
})();


// ── STICKY ADD TO CART ────────────────────────────────
(function() {
  window.StickyATC = {
    init() {
      // Only on product page
      const addBtn = document.getElementById('addCartBtn');
      if (!addBtn) return;

      // Create sticky bar
      if (!document.getElementById('stickyAtc')) {
        const bar = document.createElement('div');
        bar.id = 'stickyAtc';
        bar.className = 'sticky-atc';
        bar.innerHTML = `
          <span class="sticky-atc-title" id="stickyTitle"></span>
          <span class="sticky-atc-price" id="stickyPrice"></span>
          <button class="sticky-atc-btn" onclick="addToCart()">Add to cart</button>`;
        document.body.appendChild(bar);
      }

      // Show/hide based on scroll
      const observer = new IntersectionObserver(entries => {
        const bar = document.getElementById('stickyAtc');
        if (!bar) return;
        // Show sticky bar when original button is NOT visible
        if (entries[0].isIntersecting) {
          bar.classList.remove('visible');
        } else {
          bar.classList.add('visible');
          // Update content
          const title = document.getElementById('prodTitle');
          const price = document.getElementById('prodPrice');
          document.getElementById('stickyTitle').textContent = title?.textContent || '';
          document.getElementById('stickyPrice').textContent = price?.textContent || '';
        }
      }, { threshold: 0 });

      observer.observe(addBtn);
    }
  };
})();


// ── EMAIL POPUP (Welcome Discount) ─────────────────────
(function() {
  window.EmailPopup = {
    init(options = {}) {
      const {
        title = 'Get 10% Off',
        subtitle = 'Subscribe for your first order discount',
        discountCode = 'WELCOME10',
        delay = 5000,  // ms before showing
        storageKey = 'sivra_popup_dismissed',
      } = options;

      // Don't show if already dismissed
      if (localStorage.getItem(storageKey)) return;
      // Don't show on checkout/cart pages
      if (location.pathname.includes('checkout') || location.pathname.includes('cart')) return;

      setTimeout(() => {
        if (document.getElementById('emailPopupOverlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'emailPopupOverlay';
        overlay.className = 'email-popup-overlay open';
        overlay.onclick = function(e) { if (e.target === overlay) EmailPopup.dismiss(storageKey); };
        overlay.innerHTML = `
          <div class="email-popup">
            <div class="email-popup-hero">
              <h2>${title}</h2>
              <p>${subtitle}</p>
            </div>
            <div class="email-popup-body">
              <input class="email-popup-input" id="popupEmail" type="email" placeholder="Enter your email"
                onkeydown="if(event.key==='Enter')EmailPopup.submit('${discountCode}','${storageKey}')"/>
              <button class="email-popup-btn" onclick="EmailPopup.submit('${discountCode}','${storageKey}')">
                Get my discount →
              </button>
              <button class="email-popup-skip" onclick="EmailPopup.dismiss('${storageKey}')">
                No thanks, I'll pay full price
              </button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
      }, delay);
    },

    submit(code, storageKey) {
      const email = document.getElementById('popupEmail')?.value?.trim();
      if (!email || !email.includes('@')) {
        document.getElementById('popupEmail').style.borderColor = '#c0392b';
        return;
      }
      // Save email locally (you can also POST to an API)
      try {
        const emails = JSON.parse(localStorage.getItem('sivra_email_subscribers') || '[]');
        if (!emails.includes(email)) { emails.push(email); localStorage.setItem('sivra_email_subscribers', JSON.stringify(emails)); }
      } catch(e) {}

      // Show success
      const popup = document.querySelector('.email-popup');
      if (popup) {
        popup.innerHTML = `
          <div class="email-popup-hero" style="padding:40px 24px">
            <div style="font-size:40px;margin-bottom:12px">🎉</div>
            <h2>You're in!</h2>
            <p style="margin-top:8px">Use code <strong style="background:rgba(255,255,255,0.2);padding:2px 10px;border-radius:4px;font-size:18px;letter-spacing:1px">${code}</strong> at checkout</p>
          </div>
          <div class="email-popup-body">
            <button class="email-popup-btn" onclick="EmailPopup.dismiss('${storageKey}')">Start shopping →</button>
          </div>`;
      }
      localStorage.setItem(storageKey, '1');
    },

    dismiss(storageKey) {
      localStorage.setItem(storageKey || 'sivra_popup_dismissed', '1');
      const el = document.getElementById('emailPopupOverlay');
      if (el) el.remove();
    }
  };
})();


// ── COUNTDOWN TIMER ──────────────────────────────────
(function() {
  window.CountdownTimer = {
    init(options = {}) {
      const {
        endDate = null,     // Specific date: '2026-04-15T00:00:00'
        hours = null,       // OR countdown from now: 48 (hours)
        text = '🔥 SALE ENDS IN',
        elementId = 'annBar',  // Attach to announcement bar
        bgColor = '#c0392b',
      } = options;

      let target;
      if (endDate) {
        target = new Date(endDate).getTime();
      } else if (hours) {
        // Use stored end time so it doesn't reset on page reload
        const stored = localStorage.getItem('sivra_countdown_end');
        if (stored && parseInt(stored) > Date.now()) {
          target = parseInt(stored);
        } else {
          target = Date.now() + hours * 60 * 60 * 1000;
          localStorage.setItem('sivra_countdown_end', target);
        }
      } else {
        return;
      }

      const el = document.getElementById(elementId);
      if (!el) return;

      function update() {
        const diff = target - Date.now();
        if (diff <= 0) {
          el.innerHTML = '⏰ Sale has ended';
          return;
        }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);

        let timeStr = '';
        if (d > 0) timeStr += `<span class="countdown-digit">${d}d</span> `;
        timeStr += `<span class="countdown-digit">${String(h).padStart(2,'0')}h</span> `;
        timeStr += `<span class="countdown-digit">${String(m).padStart(2,'0')}m</span> `;
        timeStr += `<span class="countdown-digit">${String(s).padStart(2,'0')}s</span>`;

        el.innerHTML = `${text} ${timeStr}`;
        el.style.display = '';
        el.style.background = bgColor;
      }

      update();
      setInterval(update, 1000);
    }
  };
})();


// ── STOCK URGENCY ON PRODUCT CARDS ──────────────────
(function() {
  window.StockUrgency = {
    // Call after product grid renders to add "Only X left" badges
    addBadges() {
      document.querySelectorAll('.product-card').forEach(card => {
        const wrap = card.querySelector('.product-img-wrap');
        if (!wrap || wrap.querySelector('.stock-badge')) return;
        // Read stock from data attribute if available
        const qty = parseInt(card.dataset.qty || '999');
        const trackQty = card.dataset.trackQty !== '0';
        if (trackQty && qty > 0 && qty <= 5) {
          const badge = document.createElement('span');
          badge.className = 'stock-badge';
          badge.textContent = `Only ${qty} left`;
          wrap.appendChild(badge);
        }
      });
    }
  };
})();


// ── CART UPSELL / CROSS-SELL ─────────────────────────
(function() {
  window.CartUpsell = {
    async init(storeSlug) {
      if (!storeSlug) return;
      const cartItemsEl = document.querySelector('.cart-item')?.parentElement;
      if (!cartItemsEl) return;

      // Don't add if already exists
      if (document.getElementById('cartUpsell')) return;

      try {
        const cart = JSON.parse(localStorage.getItem('sivra_cart') || '[]');
        if (!cart.length) return;

        // Fetch products for recommendations
        const res = await fetch(`/api/storefront/${storeSlug}/products?limit=20`);
        const data = await res.json();
        const products = (data.products || []).filter(p => {
          // Exclude items already in cart
          return !cart.find(c => c.id === p.id);
        }).slice(0, 3);

        if (!products.length) return;

        const upsellDiv = document.createElement('div');
        upsellDiv.id = 'cartUpsell';
        upsellDiv.className = 'cart-upsell';
        upsellDiv.innerHTML = `
          <div class="cart-upsell-title">✨ You might also like</div>
          ${products.map(p => {
            const imgs = Array.isArray(p.images) ? p.images : JSON.parse(p.images || '[]');
            const img = imgs[0] || '';
            return `<div class="upsell-item" onclick="location.href='sivra-product.html?id=${p.id}&store=${storeSlug}'">
              <div class="upsell-img" style="${img ? `background-image:url(${img});background-size:cover` : 'display:flex;align-items:center;justify-content:center;font-size:16px;color:#ccc'}">
                ${img ? '' : '📦'}
              </div>
              <div class="upsell-info">
                <div class="upsell-name">${p.title}</div>
                <div class="upsell-price">$${parseFloat(p.price||0).toFixed(2)}</div>
              </div>
              <button class="upsell-add" onclick="event.stopPropagation()">+ Add</button>
            </div>`;
          }).join('')}`;

        cartItemsEl.appendChild(upsellDiv);
      } catch(e) { /* Upsell is non-critical */ }
    }
  };
})();


// ── BUNDLE DISCOUNT BANNER ──────────────────────────
(function() {
  window.BundleBanner = {
    // Show on product page: "Buy 2+ jerseys and save!"
    init(options = {}) {
      const {
        minQty = 2,
        discount = '15%',
        message = null,
      } = options;

      const productInfo = document.getElementById('productInfo');
      if (!productInfo || document.getElementById('bundleBanner')) return;

      const banner = document.createElement('div');
      banner.id = 'bundleBanner';
      banner.className = 'bundle-banner';
      banner.innerHTML = `
        <span class="bundle-icon">🏷️</span>
        <div>
          <strong>${message || `Buy ${minQty}+ jerseys and save ${discount}!`}</strong>
          <div style="font-size:12px;opacity:0.85;margin-top:2px">Discount applied automatically at checkout</div>
        </div>`;

      // Insert after price, before stock info
      const stockInfo = document.getElementById('stockInfo');
      if (stockInfo) stockInfo.insertAdjacentElement('beforebegin', banner);
      else productInfo.insertAdjacentElement('afterbegin', banner);
    }
  };
})();


// ── TRUST SECTION ──────────────────────────────────
(function() {
  window.TrustSection = {
    init(containerId) {
      const container = document.getElementById(containerId);
      if (!container || document.getElementById('trustSection')) return;

      const section = document.createElement('div');
      section.id = 'trustSection';
      section.className = 'trust-section';
      section.innerHTML = `
        <div class="trust-item-card">
          <div class="trust-icon">🚚</div>
          <div class="trust-label">Fast Shipping</div>
          <div class="trust-desc">Orders processed within 24 hours. Worldwide delivery available.</div>
        </div>
        <div class="trust-item-card">
          <div class="trust-icon">🔒</div>
          <div class="trust-label">Secure Checkout</div>
          <div class="trust-desc">256-bit SSL encryption. Your data is always protected.</div>
        </div>
        <div class="trust-item-card">
          <div class="trust-icon">↩️</div>
          <div class="trust-label">Easy Returns</div>
          <div class="trust-desc">30-day return policy. No questions asked.</div>
        </div>
        <div class="trust-item-card">
          <div class="trust-icon">⭐</div>
          <div class="trust-label">Quality Guaranteed</div>
          <div class="trust-desc">Premium materials. Authentic designs. Every time.</div>
        </div>`;

      container.insertAdjacentElement('beforebegin', section);
    }
  };
})();


// ── AUTO-INIT ──────────────────────────────────────
// Call on product page after product loads
window.initProductEnhancements = function(options = {}) {
  SizeGuide.init(options.sizeGuideType || 'default');
  StickyATC.init();
  BundleBanner.init(options.bundle || {});
};

// Call on storefront main page
window.initStorefrontEnhancements = function(options = {}) {
  if (options.emailPopup !== false) {
    EmailPopup.init(options.emailPopup || {});
  }
  if (options.countdown) {
    CountdownTimer.init(options.countdown);
  }
};

// Call on cart page
window.initCartEnhancements = function(storeSlug) {
  CartUpsell.init(storeSlug);
};
