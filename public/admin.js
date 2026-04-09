/* ═══════════════════════════════════════════════
   SIVRA ADMIN — Shared JavaScript
   Auth, API, Sidebar, Topbar, UI utilities
   ═══════════════════════════════════════════════ */

// ── Auth & Session ──────────────────────────────
const Auth = {
  getSession() {
    try { return JSON.parse(localStorage.getItem('sivra_session') || 'null'); } catch(e) { return null; }
  },
  getToken() {
    const s = this.getSession();
    return (s && s.token) || localStorage.getItem('sivra_token') || null;
  },
  getStore() {
    const s = this.getSession();
    return (s && s.store) || null;
  },
  getMerchant() {
    const s = this.getSession();
    return (s && s.merchant) || null;
  },
  getSlug() {
    const store = this.getStore();
    return (store && store.slug) || localStorage.getItem('sivra_store_slug') || '';
  },
  setSession(data) {
    localStorage.setItem('sivra_token', data.token);
    localStorage.setItem('sivra_session', JSON.stringify(data));
    if (data.store && data.store.slug) {
      localStorage.setItem('sivra_store_slug', data.store.slug);
    }
  },
  logout() {
    localStorage.removeItem('sivra_token');
    localStorage.removeItem('sivra_session');
    localStorage.removeItem('sivra_store_slug');
    window.location.href = 'sivra-login.html';
  },
  async requireAuth(redirect = 'sivra-login.html') {
    const token = this.getToken();
    if (!token) { window.location.href = redirect; return null; }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        this.logout();
        return null;
      }
      const data = await res.json();
      const session = {
        token,
        merchant: data.merchant,
        store: data.store
      };
      this.setSession(session);
      return session;
    } catch(e) {
      // Network error — use cached session
      return this.getSession();
    }
  }
};

// ── API Client ──────────────────────────────────
const API = {
  async request(method, path, body = null) {
    const token = Auth.getToken();
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed (' + res.status + ')');
    return data;
  },
  get(path)         { return this.request('GET',    path); },
  post(path, body)  { return this.request('POST',   path, body); },
  patch(path, body) { return this.request('PATCH',  path, body); },
  put(path, body)   { return this.request('PUT',    path, body); },
  del(path)         { return this.request('DELETE', path); },
};

// ── Toast ──────────────────────────────────────
const Toast = {
  _el: null,
  _timer: null,
  show(message, type = 'default', duration = 2500) {
    if (!this._el) this._el = document.getElementById('sivra-toast');
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.id = 'sivra-toast';
      this._el.className = 'toast';
      document.body.appendChild(this._el);
    }
    this._el.textContent = message;
    this._el.className = 'toast' + (type !== 'default' ? ' toast-' + type : '');
    clearTimeout(this._timer);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { this._el.classList.add('show'); });
    });
    this._timer = setTimeout(() => { this._el.classList.remove('show'); }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error', 4000); },
};
// Global shorthand
function sivraToast(msg, type) { Toast.show(msg, type || 'default'); }

// ── Modal ───────────────────────────────────────
const Modal = {
  confirm(title, message, onConfirm, options = {}) {
    const existing = document.getElementById('_sivra_confirm');
    if (existing) existing.remove();

    const btnLabel = options.danger ? 'Delete' : (options.confirmLabel || 'Confirm');
    const btnClass = options.danger ? 'btn btn-critical' : 'btn btn-primary';

    const el = document.createElement('div');
    el.id = '_sivra_confirm';
    el.className = 'modal-overlay open';
    el.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title">${title}</span>
          <button class="modal-close" onclick="document.getElementById('_sivra_confirm').remove()">×</button>
        </div>
        <div class="modal-body">
          <p style="font-size:14px;color:#303030;line-height:1.6">${message}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('_sivra_confirm').remove()">Cancel</button>
          <button class="${btnClass}" id="_sivra_confirm_btn">${btnLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('_sivra_confirm_btn').onclick = () => {
      el.remove();
      onConfirm();
    };
  }
};

// ── Navigation Config ──────────────────────────
const NAV = {
  items: [
    {
      id: 'home', label: 'Home', href: 'sivra-dashboard.html',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 7l7-5 7 5v9H2V7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 18v-6h4v6" stroke="currentColor" stroke-width="1.4"/></svg>`
    },
    {
      id: 'orders', label: 'Orders', href: 'sivra-orders.html', badge: 'sbOrderBadge',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5 6h8M5 9h8M5 12h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      children: [
        { label: 'All orders',         href: 'sivra-orders.html' },
        { label: 'Draft orders',       href: 'sivra-draft-orders.html' },
        { label: 'Abandoned checkouts',href: 'sivra-abandoned.html' },
      ]
    },
    {
      id: 'products', label: 'Products', href: 'sivra-products.html',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 5l7-3 7 3v8l-7 3-7-3V5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 2v14M2 5l7 3 7-3" stroke="currentColor" stroke-width="1.4"/></svg>`,
      children: [
        { label: 'All products',   href: 'sivra-products.html' },
        { label: 'Collections',    href: 'sivra-collections.html' },
        { label: 'Inventory',      href: 'sivra-inventory.html' },
        { label: 'Gift cards',     href: '#', comingSoon: true },
      ]
    },
    {
      id: 'customers', label: 'Customers', href: 'sivra-customers.html',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M3 15c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
      children: [
        { label: 'All customers', href: 'sivra-customers.html' },
        { label: 'Import customers', href: 'sivra-customers-import.html' },
      ]
    },
    {
      id: 'analytics', label: 'Analytics', href: 'sivra-analytics.html',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="10" width="3" height="6" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="7" y="6" width="3" height="10" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="12" y="2" width="3" height="14" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>`,
      children: [
        { label: 'Reports', href: 'sivra-analytics.html' },
        { label: 'Live view', href: 'sivra-live-view.html' },
      ]
    },
    {
      id: 'marketing', label: 'Marketing', href: 'sivra-marketing.html',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9h3l2-6 4 12 2-6h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      id: 'discounts', label: 'Discounts', href: 'sivra-discounts.html',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="6" cy="6" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M4 14L14 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
    },
  ],
  channels: [
    {
      id: 'online-store', label: 'Online Store',
      icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12M2 8h12" stroke="currentColor" stroke-width="1.2"/></svg>`,
      children: [
        { label: 'Themes',       href: 'sivra-themes.html' },
        { label: 'Theme settings', href: 'sivra-themes.html' },
        { label: 'Blog posts',   href: 'sivra-blog.html' },
        { label: 'Pages',        href: 'sivra-pages.html' },
        { label: 'Navigation',   href: 'sivra-navigation.html' },
        { label: 'Preferences',  href: 'sivra-settings.html' },
      ]
    }
  ],
  bottomItems: [
    {
      id: 'settings', label: 'Settings', href: 'sivra-settings.html',
      icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.4 3.4l1.4 1.4M13.2 13.2l1.4 1.4M14.6 3.4l-1.4 1.4M4.8 13.2l-1.4 1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`
    },
  ]
};

// ── Sidebar builder ─────────────────────────────
function buildSidebar(activeId) {
  const session = Auth.getSession();
  const store = session && session.store;
  const merchant = session && session.merchant;
  const storeName = (store && store.name) || 'My Store';
  const initials = storeName.slice(0, 2).toUpperCase();
  const merchantName = merchant ? ((merchant.firstName || merchant.first_name || '') + ' ' + (merchant.lastName || merchant.last_name || '')).trim() : 'Admin';
  const avatarInitials = merchantName ? merchantName[0].toUpperCase() : 'A';

  function icon(item) {
    return `<span class="sb-icon">${item.icon || ''}</span>`;
  }

  function navItem(item) {
    const isActive = activeId === item.id || (item.children && item.children.some(c => c.href && window.location.pathname.endsWith(c.href)));
    const hasKids = item.children && item.children.length > 0;
    const isOpen = isActive || (item.children && item.children.some(c => window.location.pathname.endsWith(c.href)));
    return `
      <div class="sb-item${isActive ? ' active' : ''}${hasKids && isOpen ? ' open' : ''}"
           onclick="sivraNav(this,'${item.href||'#'}',${hasKids})"
           data-id="${item.id}">
        ${icon(item)}
        <span class="sb-label">${item.label}</span>
        ${item.badge ? `<span class="sb-badge" id="${item.badge}" style="display:none"></span>` : ''}
        ${hasKids ? `<svg class="sb-caret" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 4l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>` : ''}
      </div>
      ${hasKids ? `<div class="sb-children${isOpen ? ' open' : ''}" id="kids-${item.id}">
        ${item.children.map(c => `<div class="sb-child${(c.href && c.href !== '#' && window.location.pathname.endsWith(c.href)) ? ' active' : ''}" onclick="${c.comingSoon ? 'sivraToast(\'Coming soon\')' : 'location.href=\''+c.href+'\''}">${c.label}${c.comingSoon ? ' <span style="font-size:9px;opacity:0.5;font-weight:500">SOON</span>' : ''}</div>`).join('')}
      </div>` : ''}`;
  }

  const sidebarEl = document.querySelector('.sidebar');
  if (!sidebarEl) return;

  sidebarEl.innerHTML = `
    <div class="sb-brand">
      <div class="sb-brand-mark">S</div>
      <span class="sb-brand-name">Sivra</span>
    </div>
    <div class="sb-store" onclick="sivraToast('Store switcher — switch stores from your account')">
      <div class="sb-store-av">${initials}</div>
      <span class="sb-store-name">${storeName}</span>
      <svg class="sb-store-caret" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 4l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    </div>

    <div class="sb-scroll">
      <div>
        ${NAV.items.map(navItem).join('')}
      </div>

      <div style="margin-top:8px">
        <div class="sb-section">
          <span>Sales channels</span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </div>
        ${NAV.channels.map(ch => {
          const isChildActive = (ch.children||[]).some(c => window.location.pathname.endsWith(c.href));
          const shouldOpen = activeId===ch.id || isChildActive;
          return `
          <div class="sb-item${activeId===ch.id?' active':''}${shouldOpen?' open':''}" onclick="sivraNav(this,'#',true)" data-id="${ch.id}">
            <span class="sb-icon">${ch.icon||''}</span>
            <span class="sb-label">${ch.label}</span>
            <svg class="sb-caret" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 4l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </div>
          <div class="sb-children${shouldOpen?' open':''}" id="kids-${ch.id}">
            ${(ch.children||[]).map(c=>`<div class="sb-child${(c.href && c.href !== '#' && window.location.pathname.endsWith(c.href)) ? ' active' : ''}" onclick="location.href='${c.href}'">${c.label}</div>`).join('')}
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="sb-bottom">
      ${NAV.bottomItems.map(navItem).join('')}
    </div>`;
}

// ── Topbar builder ──────────────────────────────
function buildTopbar() {
  const merchant = Auth.getMerchant();
  const initials = merchant
    ? ((merchant.firstName || merchant.first_name || 'A')[0]).toUpperCase()
    : 'A';
  const el = document.getElementById('sivraTopbar');
  if (!el) return;

  el.innerHTML = `
    <div class="topbar-search" onclick="this.querySelector('input').focus()">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4" stroke="rgba(255,255,255,0.5)" stroke-width="1.3"/>
        <path d="M9 9l3 3" stroke="rgba(255,255,255,0.5)" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
      <input type="text" placeholder="Search" id="topbar-search-input" onkeydown="if(event.key==='Enter')globalSearch(this.value)"/>
      <div class="kbd-hint"><span class="kbd">Ctrl</span><span class="kbd">K</span></div>
    </div>
    <div class="topbar-spacer"></div>
    <button class="topbar-btn" title="View storefront" onclick="openStorefront()">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM1.5 8h13M8 1.5c-2 0-3.5 2.9-3.5 6.5S6 14.5 8 14.5s3.5-2.9 3.5-6.5S10 1.5 8 1.5z" stroke="rgba(255,255,255,0.65)" stroke-width="1.3"/></svg>
    </button>
    <button class="topbar-btn" title="Notifications">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1a4.5 4.5 0 0 1 4.5 4.5c0 3.5 1.5 4.5 1.5 4.5H2s1.5-1 1.5-4.5A4.5 4.5 0 0 1 8 1zM6.5 13a1.5 1.5 0 0 0 3 0" stroke="rgba(255,255,255,0.65)" stroke-width="1.3"/></svg>
    </button>
    <div class="topbar-avatar" title="${merchant ? (merchant.firstName || 'Admin') : 'Admin'}" onclick="showAccountMenu()">${initials}</div>`;

  // Keyboard shortcut
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('topbar-search-input')?.focus();
    }
  });
}

// ── Nav helpers ─────────────────────────────────
function sivraNav(el, href, hasKids) {
  if (hasKids) {
    el.classList.toggle('open');
    const id = el.dataset.id;
    const kids = document.getElementById('kids-' + id);
    if (kids) kids.classList.toggle('open');
    // Also navigate to the parent page if it has a real href
    if (href && href !== '#') {
      location.href = href;
    }
  } else if (href && href !== '#') {
    location.href = href;
  }
}

function sivraToggle(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ── Global search ────────────────────────────────
function globalSearch(q) {
  if (!q || !q.trim()) return;
  sivraToast('Search: ' + q);
}

// ── Open storefront ──────────────────────────────
function openStorefront() {
  const slug = Auth.getSlug();
  window.open('/sivra-storefront.html' + (slug ? '?store=' + slug : ''), '_blank');
}

// ── Account menu ─────────────────────────────────
function showAccountMenu() {
  const existing = document.getElementById('_account_menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.id = '_account_menu';
  menu.style.cssText = 'position:fixed;top:52px;right:8px;background:white;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.2);z-index:9998;min-width:200px;overflow:hidden;border:1px solid #e3e3e3';
  const merchant = Auth.getMerchant();
  const store = Auth.getStore();
  menu.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid #e3e3e3">
      <div style="font-size:13px;font-weight:600">${merchant ? ((merchant.firstName||merchant.first_name||'')+ ' '+(merchant.lastName||merchant.last_name||'')).trim() : 'Admin'}</div>
      <div style="font-size:12px;color:#6d7175">${merchant ? merchant.email : ''}</div>
    </div>
    <div style="padding:4px">
      <div onclick="location.href='sivra-settings.html#account'" style="padding:8px 12px;font-size:13px;border-radius:6px;cursor:pointer" onmouseover="this.style.background='#f6f6f7'" onmouseout="this.style.background=''" >Account settings</div>
      <div onclick="location.href='sivra-settings.html'" style="padding:8px 12px;font-size:13px;border-radius:6px;cursor:pointer" onmouseover="this.style.background='#f6f6f7'" onmouseout="this.style.background=''">Store settings</div>
      <div style="height:1px;background:#e3e3e3;margin:4px 0"></div>
      <div onclick="Auth.logout()" style="padding:8px 12px;font-size:13px;border-radius:6px;cursor:pointer;color:#c0392b" onmouseover="this.style.background='#fde8e8'" onmouseout="this.style.background=''">Log out</div>
    </div>`;
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 10);
}

// ── Init function (called on every admin page) ───
async function initAdmin(activeId) {
  // Build sidebar placeholder immediately
  const sidebarEl = document.querySelector('.sidebar');
  if (sidebarEl && !sidebarEl.dataset.built) {
    sidebarEl.dataset.built = '1';
    buildSidebar(activeId);
  }

  // Build topbar
  buildTopbar();

  // Auth check
  const session = await Auth.requireAuth('sivra-login.html');
  if (!session) return null;

  // Rebuild sidebar with real session data
  buildSidebar(activeId);
  buildTopbar();

  // Fetch unfulfilled order count for sidebar badge
  try {
    const data = await API.get('/api/orders?fulfillment_status=unfulfilled&limit=100');
    const count = (data.orders || []).filter(o => o.status !== 'cancelled').length;
    const badge = document.getElementById('sbOrderBadge');
    if (badge && count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    }
  } catch(e) { /* badge is optional */ }

  return session;
}

// ── Pagination helper ────────────────────────────
function paginate(items, page, perPage = 25) {
  const total = items.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (page - 1) * perPage;
  const end = start + perPage;
  return {
    items: items.slice(start, end),
    page, perPage, total, totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// ── Format helpers ────────────────────────────────
const Fmt = {
  money(v, currency = 'AUD') {
    const num = parseFloat(v) || 0;
    return '$' + num.toFixed(2);
  },
  date(v, opts = {}) {
    if (!v) return '—';
    return new Date(v).toLocaleDateString('en-AU', opts.format || { day: 'numeric', month: 'short', year: 'numeric' });
  },
  datetime(v) {
    if (!v) return '—';
    return new Date(v).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  relativeTime(v) {
    if (!v) return '—';
    const diff = Date.now() - new Date(v).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return this.date(v);
  },
  slug(v) {
    return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },
  truncate(v, len = 40) {
    if (!v) return '—';
    return v.length > len ? v.slice(0, len) + '…' : v;
  },
  initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  },
  number(v) {
    const n = parseFloat(v) || 0;
    return n.toLocaleString('en-AU');
  },
  percent(v, decimals = 1) {
    return (parseFloat(v) || 0).toFixed(decimals) + '%';
  },
  capitalize(v) {
    if (!v) return '—';
    return v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ');
  },
  statusBadge(status) {
    const map = {
      active:'badge-success', published:'badge-success', paid:'badge-success',
      fulfilled:'badge-success', open:'badge-info',
      draft:'badge-default', archived:'badge-default', cancelled:'badge-default',
      refunded:'badge-default', closed:'badge-default',
      pending:'badge-warning', unpaid:'badge-warning', unfulfilled:'badge-warning',
      partial:'badge-info',
    };
    const cls = map[(status||'').toLowerCase()] || 'badge-default';
    return `<span class="badge ${cls}" style="text-transform:capitalize">${(status||'—').replace(/_/g,' ')}</span>`;
  }
};

// ── CSV export helper ─────────────────────────────
function exportCSV(rows, filename = 'export.csv') {
  const csv = rows.map(r =>
    r.map(c => {
      const s = String(c == null ? '' : c);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    }).join(',')
  ).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

// ── Backwards compat aliases (for old pages) ─────
window.Sivra = {
  requireAuth: (redirect) => Auth.requireAuth(redirect),
  request: (method, url, data) => API.request(method, url, data),
  getSession: () => Auth.getSession(),
  getToken: () => Auth.getToken(),
};
window.initSivra = (activeId) => {
  buildSidebar(activeId);
  buildTopbar();
};
