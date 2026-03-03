// Relative path works whether accessed from localhost or any LAN IP.
// In dev mode Vite proxies /api → localhost:3001 (see vite.config.js).
const BASE = '/api';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  prices: () => get('/exchange/prices'),
  allDetails: () => get('/exchange/alldetails'),
  matDetails: (matId) => get(`/exchange/details/${matId}`),
  priceHistory: (matId, days = 30) => get(`/exchange/history/${matId}?days=${days}`),
  gamedata: () => get('/gamedata'),
  ratelimit: () => get('/ratelimit'),
  profits: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/profits${qs ? '?' + qs : ''}`);
  },
  trackerStatus: () => get('/tracker/status'),
  trackerSnapshots: (matId, limit = 120) => get(`/tracker/snapshots/${matId}?limit=${limit}`),
  trackerOrders: (matId) => get(`/tracker/orders/${matId}`),
  trackerActivity: (matId, hours = 24) => get(`/tracker/activity/${matId}?hours=${hours}`),
  trackerMarketshare: (matId, hours = 24) => get(`/tracker/marketshare/${matId}?hours=${hours}`),
  trackerCompanyActivity: (matId, hours = 24) => get(`/tracker/company-activity/${matId}?hours=${hours}`),
  trackerRecent: (matId, limit = 10) => get(`/tracker/recent/${matId}?limit=${limit}`),
};
