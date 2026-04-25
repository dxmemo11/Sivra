// SIVRA Storefront — Cart Drawer + Helpers
// Include on every storefront page: <script src="storefront-app.js"></script>
(function(){
'use strict';

// ── STATE ──────────────────────────────────────────────────────────
let _storeSlug = localStorage.getItem('sivra_store_slug') || '';
const FREE_SHIP_THRESHOLD = 75;

// ── HELPERS ────────────────────────────────────────────────────────
window.SivraStore = {
  getStoreSlug(){ return _storeSlug; },
  setStoreSlug(s){ _storeSlug = s; localStorage.setItem('sivra_store_slug', s); },
  getCart(){ try { return JSON.parse(localStorage.getItem('sivra_cart') || '[]'); } catch(e) { return []; } },
  saveCart(c){ localStorage.setItem('sivra_cart', JSON.stringify(c)); this.updateBadges(); this.renderDrawer(); },
  updateBadges(){
    const n = this.getCart().reduce((s,i) => s + (i.qty||0), 0);
    document.querySelectorAll('.cart-count').forEach(el => {
      el.textContent = n;
      el.style.display = n > 0 ? 'flex' : 'none';
    });
  },
  fmtMoney(v){ return '$' + parseFloat(v||0).toFixed(2); },
  toast(msg){
    let t = document.getElementById('sivraToast');
    if (!t) { t = document.createElement('div'); t.id = 'sivraToast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2500);
  },
  goHome(){ location.href = 'sivra-storefront.html?store=' + _storeSlug; },
  goCart(){ this.openDrawer(); },
  goCheckout(){ location.href = 'sivra-checkout.html?store=' + _storeSlug; },
  goPage(slug){ location.href = 'sivra-policy.html?store=' + _storeSlug + '&page=' + slug; },
  goBlog(){ location.href = 'sivra-blog-storefront.html?store=' + _storeSlug; },
  goCollection(id){ location.href = 'sivra-collection.html?store=' + _storeSlug + '&id=' + id; },
  goProduct(id){ location.href = 'sivra-product.html?id=' + id + '&store=' + _storeSlug; },

  // ── DRAWER ──────────────────────────────────────────────────────
  ensureDrawer(){
    if (document.getElementById('cartDrawer')) return;
    const html = `
      <div class="drawer-overlay" id="drawerOverlay" onclick="SivraStore.closeDrawer()"></div>
      <aside class="cart-drawer" id="cartDrawer" aria-label="Shopping cart">
        <div class="drawer-head">
          <div class="drawer-title">Your Cart<span class="drawer-count" id="drawerCount">0</span></div>
          <button class="drawer-close" onclick="SivraStore.closeDrawer()" aria-label="Close cart">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div id="shipProgress"></div>
        <div class="drawer-items" id="drawerItems"></div>
        <div class="drawer-foot" id="drawerFoot" style="display:none">
          <div class="drawer-subtotal">
            <span class="drawer-subtotal-lbl">Subtotal</span>
            <span class="drawer-subtotal-amt" id="drawerSubtotal">$0.00</span>
          </div>
          <div class="drawer-tax">Shipping & taxes calculated at checkout</div>
          <button class="drawer-checkout" onclick="SivraStore.goCheckout()"><span>Checkout</span> <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="position:relative;z-index:1"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <div class="drawer-secure">
            <span>🔒 Secure</span>
            <span>🚀 Fast ship</span>
            <span>↺ 30-day returns</span>
          </div>
        </div>
      </aside>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild); // overlay
    document.body.appendChild(wrap.firstElementChild); // drawer
  },
  openDrawer(){
    this.ensureDrawer();
    this.renderDrawer();
    document.getElementById('drawerOverlay').classList.add('open');
    document.getElementById('cartDrawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  },
  closeDrawer(){
    const ov = document.getElementById('drawerOverlay');
    const dr = document.getElementById('cartDrawer');
    if (ov) ov.classList.remove('open');
    if (dr) dr.classList.remove('open');
    document.body.style.overflow = '';
  },
  renderDrawer(){
    const drawer = document.getElementById('cartDrawer');
    if (!drawer) return;
    const cart = this.getCart();
    const itemsEl = document.getElementById('drawerItems');
    const foot = document.getElementById('drawerFoot');
    const countEl = document.getElementById('drawerCount');
    const shipEl = document.getElementById('shipProgress');
    const count = cart.reduce((s,i) => s + (i.qty||0), 0);
    countEl.textContent = count;

    if (!cart.length) {
      itemsEl.innerHTML = `
        <div class="drawer-empty">
          <div class="drawer-empty-icon">🛒</div>
          <div class="drawer-empty-title">Your cart is empty</div>
          <div class="drawer-empty-desc">Add some kits to get started.</div>
          <button class="btn-primary" onclick="SivraStore.closeDrawer()"><span>Continue shopping</span></button>
        </div>`;
      foot.style.display = 'none';
      shipEl.innerHTML = '';
      return;
    }

    const subtotal = cart.reduce((s,i) => s + parseFloat(i.price||0) * (i.qty||1), 0);
    const remaining = Math.max(0, FREE_SHIP_THRESHOLD - subtotal);
    const pct = Math.min(100, (subtotal / FREE_SHIP_THRESHOLD) * 100);

    if (remaining > 0) {
      shipEl.innerHTML = `
        <div class="ship-progress">
          Add <strong style="color:var(--black)">${this.fmtMoney(remaining)}</strong> more for FREE shipping
          <div class="ship-progress-bar"><div class="ship-progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    } else {
      shipEl.innerHTML = `
        <div class="ship-progress complete">
          ✓ You qualify for FREE shipping!
          <div class="ship-progress-bar"><div class="ship-progress-fill" style="width:100%"></div></div>
        </div>`;
    }

    itemsEl.innerHTML = cart.map((item, i) => `
      <div class="drawer-item">
        <div class="drawer-item-img" onclick="SivraStore.goProduct('${item.id}')">
          ${item.image ? `<img src="${item.image}" alt="${item.title}"/>` : ''}
        </div>
        <div class="drawer-item-info">
          <div class="drawer-item-title" onclick="SivraStore.goProduct('${item.id}')">${item.title}</div>
          ${item.variantTitle ? `<div class="drawer-item-variant">${item.variantTitle}</div>` : ''}
          <div class="drawer-item-price">${this.fmtMoney(item.price)}</div>
          <div class="drawer-item-controls">
            <button onclick="SivraStore.changeQty(${i},-1)">−</button>
            <span>${item.qty}</span>
            <button onclick="SivraStore.changeQty(${i},1)">+</button>
          </div>
        </div>
        <button class="drawer-item-remove" onclick="SivraStore.removeItem(${i})" aria-label="Remove">×</button>
      </div>
    `).join('');

    document.getElementById('drawerSubtotal').textContent = this.fmtMoney(subtotal);
    foot.style.display = '';
  },
  changeQty(i, d){
    const c = this.getCart();
    if (!c[i]) return;
    c[i].qty = Math.max(1, (c[i].qty||1) + d);
    this.saveCart(c);
  },
  removeItem(i){
    const c = this.getCart();
    if (!c[i]) return;
    const t = c[i].title;
    c.splice(i, 1);
    this.saveCart(c);
    this.toast(t + ' removed');
  },
  addToCart(item){
    const c = this.getCart();
    const existing = c.find(i => i.key === item.key);
    if (existing) existing.qty += (item.qty || 1);
    else c.push(item);
    this.saveCart(c);
    this.openDrawer();
  },

  // ── INIT ────────────────────────────────────────────────────────
  async loadStoreData(){
    const slug = new URLSearchParams(location.search).get('store') || _storeSlug;
    if (slug) this.setStoreSlug(slug);
    if (!_storeSlug) return null;
    try {
      const res = await fetch('/api/storefront/' + _storeSlug);
      const store = await res.json();
      const name = store.name || 'Store';
      // Update branding
      document.querySelectorAll('.nav-logo').forEach(el => {
        if (store.logo_url && store.logo_url.startsWith('http')) {
          el.innerHTML = '<img src="' + store.logo_url + '" alt="' + name + '" style="height:32px;max-width:140px;object-fit:contain"/>';
        } else {
          el.textContent = name.toUpperCase();
        }
      });
      document.querySelectorAll('.footer-brand').forEach(el => el.textContent = name.toUpperCase());
      document.querySelectorAll('.footer-copy').forEach(el => el.textContent = '© ' + new Date().getFullYear() + ' ' + name);
      // Load nav menu
      this.loadMenu();
      // Load footer collections
      this.loadFooterCollections();
      return store;
    } catch(e) { console.error('Store load:', e); return null; }
  },
  async loadMenu(){
    try {
      const res = await fetch('/api/storefront/' + _storeSlug + '/menus');
      const data = await res.json();
      const menus = data.menus || [];
      const nav = menus.find(m => m.location === 'main' || m.handle === 'main-menu') || menus[0];
      if (!nav || !nav.items) return;
      const items = typeof nav.items === 'string' ? JSON.parse(nav.items) : nav.items;
      document.querySelectorAll('.nav-links').forEach(el => {
        el.innerHTML = items.map(i => {
          const click = i.url ? `location.href='${i.url}'` :
                        i.collection_id ? `SivraStore.goCollection('${i.collection_id}')` :
                        i.page_slug ? `SivraStore.goPage('${i.page_slug}')` : 'SivraStore.goHome()';
          return `<a class="nav-link" onclick="${click}">${i.title || i.name || ''}</a>`;
        }).join('');
      });
    } catch(e) {}
  },
  async loadFooterCollections(){
    try {
      const res = await fetch('/api/storefront/' + _storeSlug + '/collections');
      const data = await res.json();
      const colls = (data.collections || []).filter(c => (c.product_count||0) > 0).slice(0, 5);
      document.querySelectorAll('.footer-coll-links').forEach(el => {
        el.innerHTML = colls.map(c => `<a class="footer-link" onclick="SivraStore.goCollection('${c.id}')">${c.name}</a>`).join('');
      });
    } catch(e) {}
  },

  // ── PRODUCT CARD HTML ───────────────────────────────────────────
  productCardHtml(p, opts = {}){
    const imgs = Array.isArray(p.images) ? p.images : (typeof p.images === 'string' ? JSON.parse(p.images || '[]') : []);
    const img = imgs[0]; const img2 = imgs[1];
    const price = parseFloat(p.price||0);
    const compare = parseFloat(p.compare_price||0);
    const isSale = compare > price;
    const savings = isSale ? Math.round((1 - price/compare) * 100) : 0;
    const isNew = p.created_at && (new Date() - new Date(p.created_at)) < 14*86400000;
    const isKids = /kids|youth|junior|child/i.test((p.title||'') + (p.tags||''));
    const isOos = p.track_qty && (p.quantity||0) <= 0 && !p.continue_selling;
    let badge = '';
    if (isOos) badge = '<div class="prod-badge oos">Sold out</div>';
    else if (isKids) badge = '<div class="prod-badge kids">Kids</div>';
    else if (isSale) badge = '<div class="prod-badge sale">-' + savings + '%</div>';
    else if (isNew) badge = '<div class="prod-badge new">New</div>';
    return `
      <a class="prod-card" onclick="SivraStore.goProduct('${p.id}')" href="javascript:void(0)">
        <div class="prod-img">
          ${badge}
          ${img ? `<img src="${img}" alt="${p.title}" loading="lazy"/>` : '<div class="prod-placeholder">👕</div>'}
          ${img2 ? `<img src="${img2}" alt="" class="prod-img-secondary" loading="lazy"/>` : ''}
          ${!isOos ? '<div class="prod-quick">Quick view</div>' : ''}
        </div>
        <div class="prod-info">
          <div class="prod-title">${p.title}</div>
          ${p.vendor ? `<div class="prod-meta">${p.vendor}</div>` : ''}
          <div class="prod-price-row">
            <span class="prod-price">${this.fmtMoney(price)}</span>
            ${isSale ? `<span class="prod-compare">${this.fmtMoney(compare)}</span>` : ''}
            ${isSale ? `<span class="prod-save">Save ${savings}%</span>` : ''}
          </div>
        </div>
      </a>`;
  },

  // ── SCROLL REVEAL ───────────────────────────────────────────────
  initReveal(){
    if (!('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }});
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
  },

  // ── NAV SCROLL EFFECT ──────────────────────────────────────────
  initNavScroll(){
    const nav = document.querySelector('.store-nav');
    if (!nav) return;
    let last = 0;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y > 10) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
      last = y;
    }, { passive: true });
  }
};

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  SivraStore.updateBadges();
  SivraStore.initReveal();
  SivraStore.initNavScroll();
  SivraStore.ensureDrawer();
});

// Close drawer on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') SivraStore.closeDrawer();
});

})();
