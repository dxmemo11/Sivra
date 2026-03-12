(function () {
  const STORAGE_KEY = 'sivra_session';
  function getSession() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { return null; } }
  function saveSession(payload) { const session = { token: payload.token, merchant: payload.merchant || null, store: payload.store || null }; localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); return session; }
  function clearSession() { localStorage.removeItem(STORAGE_KEY); }
  function getToken() { return getSession()?.token || null; }
  async function request(url, options = {}) {
    const session = getSession();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const response = await fetch(url, Object.assign({}, options, { headers }));
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) { const message = (data && data.error) || (typeof data === 'string' ? data : 'Request failed'); const error = new Error(message); error.status = response.status; error.payload = data; throw error; }
    return data;
  }
  async function requireAuth(redirectTo = 'sivra-login.html') {
    const token = getToken(); if (!token) { window.location.href = redirectTo; return null; }
    try {
      const me = await request('/api/auth/me');
      const merged = { token,
        merchant: { id: me.merchant.id, email: me.merchant.email, firstName: me.merchant.first_name, lastName: me.merchant.last_name, plan: me.merchant.plan, status: me.merchant.status, createdAt: me.merchant.created_at },
        store: me.store ? { id: me.store.id, name: me.store.name, slug: me.store.slug, description: me.store.description, category: me.store.category, currency: me.store.currency } : null };
      saveSession(merged); return merged;
    } catch (err) { clearSession(); window.location.href = redirectTo; return null; }
  }
  function formatMoney(value, currency = 'USD') { const num = Number(value || 0); try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num); } catch (_) { return `$${num.toFixed(2)}`; } }
  window.Sivra = { getSession, saveSession, clearSession, getToken, request, requireAuth, formatMoney };
})();