// Relative path works whether accessed from localhost or any LAN IP.
// In dev mode Vite proxies /api → localhost:3001 (see vite.config.js).
const BASE = '/api';

function authHeaders() {
  const token = localStorage.getItem('sessionToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get(path, authed = false) {
  const res = await fetch(`${BASE}${path}`, {
    headers: authed ? authHeaders() : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function post(path, body, authed = false) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authed ? authHeaders() : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function patch(path, body = {}, authed = false) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(authed ? authHeaders() : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function del(path, authed = false) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: authed ? authHeaders() : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  // ── Auth ───────────────────────────────────────────────────────────────────
  login:         (apiKey) => post('/auth/login', { apiKey }),
  devLogin:      (companyName, companyId) => post('/auth/dev-login', { companyName, companyId }),
  devSearch:     (q = '')               => get(`/auth/dev-search?q=${encodeURIComponent(q)}`),
  me:            ()       => get('/auth/me', true),
  logout:        ()       => post('/auth/logout', {}, true),
  revokeAccount: ()       => del('/auth/account', true),

  // ── Items ──────────────────────────────────────────────────────────────────
  allItems:    ()       => get('/items'),
  trackItem:   (matId)  => post('/items/track', { matId }, true),
  untrackItem: (matId)  => del(`/items/track/${matId}`, true),

  // ── Exchange ───────────────────────────────────────────────────────────────
  prices:      () => get('/exchange/prices'),
  allDetails:  () => get('/exchange/alldetails'),
  matDetails:  (matId) => get(`/exchange/details/${matId}`),
  priceHistory: (matId, days = 30) => get(`/exchange/history/${matId}?days=${days}`),
  gamedata:    () => get('/gamedata'),
  ratelimit:   () => get('/ratelimit'),
  profits:     (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/profits${qs ? '?' + qs : ''}`);
  },

  // ── Contracts ──────────────────────────────────────────────────────────────
  contracts:       (filters = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== ''))
    ).toString();
    return get(`/contracts${qs ? '?' + qs : ''}`, true);
  },
  postContract:    (data)    => post('/contracts', data, true),
  updateContract:  (id, data) => patch(`/contracts/${id}`, data, true),
  deleteContract:  (id)      => del(`/contracts/${id}`, true),
  fulfillContract: (id)      => patch(`/contracts/${id}/fulfill`, {}, true),
  bumpContract:    (id)      => patch(`/contracts/${id}/bump`, {}, true),
  markInterest:    (id)      => post(`/contracts/${id}/interest`, {}, true),
  removeInterest:  (id)      => del(`/contracts/${id}/interest`, true),

  // ── Notifications ──────────────────────────────────────────────────────────
  notifications:           () => get('/contracts/notifications', true),
  markNotificationsRead:   () => patch('/contracts/notifications/read', {}, true),
  dismissNotification:     (id) => del(`/contracts/notifications/${id}`, true),

  // ── Company ────────────────────────────────────────────────────────────────
  companySummary:  (hours = 24, companyId = null) =>
    get(`/company/summary?hours=${hours}${companyId ? `&companyId=${companyId}` : ''}`, true),
  companySearch:   (q = '') => get(`/company/search?q=${encodeURIComponent(q)}`, true),
  companyEvents:   (companyId = null, limit = 20, from = null, to = null) =>
    get(`/company/events?limit=${limit}${companyId ? `&companyId=${companyId}` : ''}${from ? `&from=${encodeURIComponent(from)}` : ''}${to ? `&to=${encodeURIComponent(to)}` : ''}`, true),
  companyTimeline: (hours = 24, companyId = null, bucketSecs = null) =>
    get(`/company/timeline?hours=${hours}${companyId ? `&companyId=${companyId}` : ''}${bucketSecs ? `&bucketSecs=${bucketSecs}` : ''}`, true),

  // ── Tracker ────────────────────────────────────────────────────────────────
  trackerStatus:         () => get('/tracker/status'),
  trackerSnapshots:      (matId, limit = 120) => get(`/tracker/snapshots/${matId}?limit=${limit}`),
  trackerOrders:         (matId) => get(`/tracker/orders/${matId}`),
  trackerActivity:       (matId, hours = 24) => get(`/tracker/activity/${matId}?hours=${hours}`),
  trackerMarketshare:    (matId, hours = 24) => get(`/tracker/marketshare/${matId}?hours=${hours}`),
  trackerCompanyActivity:(matId, hours = 24) => get(`/tracker/company-activity/${matId}?hours=${hours}`),
  trackerRecent:         (matId, limit = 10) => get(`/tracker/recent/${matId}?limit=${limit}`),
  trackerEvents:         (matId, from, to)   => get(`/tracker/events/${matId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  trackerPatterns:       (matId) => get(`/tracker/patterns/${matId}`),
  trackerAwards:         (matId, hours = 24) => get(`/tracker/awards/${matId}?hours=${hours}`),
  trackerPressure:       (matId) => get(`/tracker/pressure/${matId}`),
  trackerLatestBigOrder: (matId) => get(`/tracker/latest-big-order/${matId}`),
  trackerCompanyEvents:  (matId, company, hours = 24) => get(`/tracker/company-events/${matId}?company=${encodeURIComponent(company)}&hours=${hours}`),
};
