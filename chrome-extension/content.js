const GT_TRACK = 'https://galactic-track.com';
const GT_API   = 'https://api.g2.galactictycoons.com';
const INJECT_ID  = 'gt-guild-row';
const TOOLTIP_ID = 'gt-tooltip';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMatIdFromUrl() {
  const m = location.pathname.match(/^\/exchange\/(\d+)/);
  return m ? m[1] : null;
}

function fmtPrice(type, value) {
  if (type === 'fixed')   return Number(value).toLocaleString();
  if (type === 'average') return 'Avg';
  return `Market ${Number(value)}`;
}

function lowestPrice(locations) {
  if (!locations?.length) return null;
  // Prefer fixed/market_offset over average (which has price_value=0 and would always win)
  const fixed = locations.filter(l => l.price_type !== 'average');
  const pool  = fixed.length ? fixed : locations;
  return pool.reduce((a, b) => a.price_value <= b.price_value ? a : b);
}

// ── Identity (Local API auto-connect) ─────────────────────────────────────────

const IDENTITY_TTL = 24 * 60 * 60 * 1000;

async function resolveIdentity() {
  const cached = await chrome.storage.local.get(['gTag', 'companyName', 'gTagTs']);
  if (cached.gTag && Date.now() - (cached.gTagTs ?? 0) < IDENTITY_TTL) return cached;

  // Try game's Local API first
  const fromLapi = await new Promise(resolve => {
    const reqId = `gt-${Date.now()}`;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 3000);

    function handler(event) {
      if (event.source !== window) return;
      if (event.data?.type !== 'GT_LAPI_RESPONSE' || event.data?.requestId !== reqId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', handler);

      if (!event.data.success) { resolve(null); return; }
      let company;
      try { company = JSON.parse(event.data.data); } catch { resolve(null); return; }
      if (!Number.isInteger(company.id) || company.id <= 0) { resolve(null); return; }

      fetch(`${GT_API}/public/company/${company.id}/detail`)
        .then(r => r.json())
        .then(detail => {
          const gTag = detail.gTag ?? detail.guild_tag ?? '';
          if (!gTag) { resolve(null); return; }
          const companyName = company.name ?? '';
          chrome.storage.local.set({ gTag, companyName, gTagTs: Date.now() });
          resolve({ gTag, companyName });
        })
        .catch(() => resolve(null));
    }

    window.addEventListener('message', handler);
    window.postMessage({ type: 'GT_LAPI_REQUEST', action: 'getMyCompany', requestId: reqId, params: {} }, '*');
  });

  if (fromLapi) return fromLapi;

  // Fallback: use stored GT API key (same key as production tracker)
  const { gtApiKey } = await chrome.storage.local.get(['gtApiKey']);
  if (!gtApiKey) return null;

  try {
    const r1 = await fetch(`${GT_API}/public/company?apikey=${encodeURIComponent(gtApiKey)}`);
    if (!r1.ok) return null;
    const company = await r1.json();
    const companyId = company.id ?? company.cId;
    if (!Number.isInteger(companyId) || companyId <= 0) return null;

    const r2 = await fetch(`${GT_API}/public/company/${companyId}/detail`);
    if (!r2.ok) return null;
    const detail = await r2.json();
    const gTag = detail.gTag ?? detail.guild_tag ?? '';
    if (!gTag) return null;

    const companyName = company.name ?? company.companyName ?? '';
    chrome.storage.local.set({ gTag, companyName, gTagTs: Date.now() });
    return { gTag, companyName };
  } catch {
    return null;
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const STOCK_LABELS = { high: 'High', low: 'Low', to_order: 'To Order' };
const STOCK_COLORS = { high: '#22c55e', low: '#f59e0b', to_order: '#a78bfa' };

function removeTooltip() {
  document.getElementById(TOOLTIP_ID)?.remove();
}

function showTooltip(anchor, listing) {
  removeTooltip();
  const locations = listing.locations;
  if (!locations?.length) return;

  const rect = anchor.getBoundingClientRect();
  const tip  = document.createElement('div');
  tip.id = TOOLTIP_ID;
  tip.style.cssText = [
    'position:fixed',
    `top:${rect.top - 6}px`,
    `left:${rect.left}px`,
    'transform:translateY(-100%)',
    'z-index:2147483647',
    'background:#0d0d1f',
    'border:1px solid #2a2a4a',
    'border-radius:6px',
    'padding:6px 10px',
    'font-family:system-ui,sans-serif',
    'font-size:11px',
    'color:#b0b0cc',
    'box-shadow:0 4px 16px rgba(0,0,0,0.7)',
    'pointer-events:none',
    'white-space:nowrap',
    'line-height:1.8',
  ].join(';');

  locations.forEach((loc, i) => {
    if (i > 0) tip.appendChild(document.createElement('br'));

    const priceSpan = document.createElement('span');
    priceSpan.style.cssText = 'color:#d1d5db;font-weight:500;margin-right:6px';
    priceSpan.textContent = fmtPrice(loc.price_type, loc.price_value);
    tip.appendChild(priceSpan);

    if (loc.stock_level) {
      const color = STOCK_COLORS[loc.stock_level] || '#b0b0cc';
      const label = STOCK_LABELS[loc.stock_level] || loc.stock_level;
      const stockSpan = document.createElement('span');
      stockSpan.style.cssText = `color:${color};margin-right:6px`;
      stockSpan.textContent = label;
      tip.appendChild(stockSpan);
    }

    if (loc.location) {
      const locSpan = document.createElement('span');
      locSpan.style.color = '#6b7280';
      locSpan.textContent = loc.location;
      tip.appendChild(locSpan);
    }
  });

  document.body.appendChild(tip);
}

// ── Injection ─────────────────────────────────────────────────────────────────

function removeInjection() {
  removeTooltip();
  document.getElementById(INJECT_ID)?.remove();
}

function inject(table, listings, gTag) {
  removeInjection();
  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  const colCount = tbody.querySelector('tr td, tr th')
    ? tbody.querySelector('tr').children.length
    : 5;

  const tr = document.createElement('tr');
  tr.id = INJECT_ID;

  const td = document.createElement('td');
  td.colSpan = colCount;
  td.style.cssText = [
    'padding: 4px 0 4px 12px',
    'border-top: 1px solid rgba(255,255,255,0.06)',
    'font-size: 13px',
    'line-height: 1.4',
  ].join(';');

  if (listings.length === 0) {
    const empty = document.createElement('span');
    empty.style.cssText = 'color:#4b5563;font-style:italic';
    empty.textContent = 'No guild listings';
    td.appendChild(empty);
  } else {
    listings.forEach(l => {
      const best = lowestPrice(l.locations);
      if (!best) return;

      const span = document.createElement('span');
      span.style.cssText = 'margin-right:14px;white-space:nowrap;cursor:default';

      const labelEl = document.createElement('span');
      labelEl.style.color = '#6b7280';
      labelEl.textContent = `[${gTag}] ${l.company_name}:`;

      const priceEl = document.createElement('span');
      priceEl.style.cssText = 'color:#d1d5db;font-weight:500;margin-left:5px';
      priceEl.textContent = fmtPrice(best.price_type, best.price_value);

      span.appendChild(labelEl);
      span.appendChild(priceEl);

      if (l.locations.length > 1) {
        const moreEl = document.createElement('span');
        moreEl.style.cssText = 'color:#6b7280;font-size:11px;margin-left:4px';
        moreEl.textContent = `+${l.locations.length - 1}`;
        span.appendChild(moreEl);
      }

      span.addEventListener('mouseenter', () => showTooltip(span, l));
      span.addEventListener('mouseleave', removeTooltip);

      td.appendChild(span);
    });
  }

  tr.appendChild(td);
  tbody.appendChild(tr);
}

// ── Wait for the exchange table to appear (SPA load) ──────────────────────────

let tableObserver = null;

function waitForTable(listings, gTag) {
  if (tableObserver) { tableObserver.disconnect(); tableObserver = null; }

  const existing = document.querySelector('table.mb-1.align-middle.rounded.overflow-hidden.lh-xs');
  if (existing) { inject(existing, listings, gTag); return; }

  let timeout = null;
  tableObserver = new MutationObserver(() => {
    const table = document.querySelector('table.mb-1.align-middle.rounded.overflow-hidden.lh-xs');
    if (!table) return;
    tableObserver.disconnect();
    tableObserver = null;
    clearTimeout(timeout);
    inject(table, listings, gTag);
  });

  tableObserver.observe(document.body, { subtree: true, childList: true });
  timeout = setTimeout(() => {
    if (tableObserver) { tableObserver.disconnect(); tableObserver = null; }
  }, 10000);
}

// ── Listing cache (fetch-all, filter client-side) ─────────────────────────────

const listingCache = new Map(); // gTag → { ts, data }
const CACHE_TTL = 5 * 60 * 1000;

async function fetchListings(gTag) {
  const cached = listingCache.get(gTag);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const res = await fetch(`${GT_TRACK}/api/trade/public?tag=${encodeURIComponent(gTag)}`);
  if (!res.ok) return [];
  const data = await res.json();
  listingCache.set(gTag, { ts: Date.now(), data });
  return data;
}

// ── Fetch prices + inject ─────────────────────────────────────────────────────

async function run(retries = 0) {
  removeInjection();
  if (tableObserver) { tableObserver.disconnect(); tableObserver = null; }

  const { enabled } = await chrome.storage.local.get('enabled');
  if (enabled === false) return;

  const matId = getMatIdFromUrl();
  if (!matId) return;

  const identity = await resolveIdentity();
  if (!identity) {
    // Game Local API not ready yet — retry up to 3 times with increasing delay
    if (retries < 3) setTimeout(() => run(retries + 1), 2000 * (retries + 1));
    return;
  }
  const { gTag } = identity;

  try {
    const all = await fetchListings(gTag);
    const listings = all.filter(l => l.mat_id === Number(matId));
    waitForTable(listings, gTag);
  } catch { /* silent fail */ }
}

// ── SPA navigation ────────────────────────────────────────────────────────────
// Intercept history.pushState so we fire synchronously on every route change,
// rather than relying on MutationObserver timing which misses early navigations.

function onNavigate() {
  if (location.pathname.startsWith('/exchange/')) {
    run();
  } else {
    removeInjection();
  }
}

let _lastPath = location.pathname;
setInterval(() => {
  if (location.pathname === _lastPath) return;
  _lastPath = location.pathname;
  onNavigate();
}, 500);

window.addEventListener('popstate', onNavigate);

// React to toggle changes without requiring a page reload
chrome.storage.onChanged.addListener((changes) => {
  if (!('enabled' in changes)) return;
  if (changes.enabled.newValue === false) {
    removeInjection();
  } else {
    onNavigate();
  }
});

// Pre-cache identity on any game page (only when enabled)
chrome.storage.local.get('enabled', ({ enabled }) => {
  if (enabled !== false) resolveIdentity().catch(() => {});
});
run();

// ── Production Tracker ────────────────────────────────────────────────────────

const PROD_BUTTON_ID  = 'gt-prod-btn';
const PROD_PANEL_ID   = 'gt-prod-panel';
const BASES_CACHE_TTL = 5 * 60 * 1000; // 5 min

const COL_OK   = '#22c55e'; // > 2 days
const COL_LOW  = '#f59e0b'; // 1–2 days
const COL_CRIT = '#ef4444'; // ≤ 1 day
function daysColour(d) { return d > 2 ? COL_OK : d > 1 ? COL_LOW : COL_CRIT; }

// ── Gamedata loader ───────────────────────────────────────────────────────────

let _gamedata = null;
async function loadGamedata() {
  if (_gamedata) return _gamedata;
  const url  = chrome.runtime.getURL('data/gamedata.json');
  const resp = await fetch(url);
  _gamedata  = await resp.json();
  return _gamedata;
}

// ── API key reader ────────────────────────────────────────────────────────────

async function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['gtApiKey'], ({ gtApiKey }) => resolve(gtApiKey ?? null));
  });
}

// ── Bases fetch (5-min cache) ─────────────────────────────────────────────────

let _basesCache = { data: null, ts: 0 };
async function fetchBases(apiKey) {
  if (_basesCache.data && Date.now() - _basesCache.ts < BASES_CACHE_TTL) {
    return _basesCache.data;
  }
  const resp = await fetch(`${GT_API}/public/company/bases?apikey=${encodeURIComponent(apiKey)}`);
  if (!resp.ok) throw new Error(`bases fetch failed: ${resp.status}`);
  const data = await resp.json();
  _basesCache = { data, ts: Date.now() };
  return data;
}

// ── Per-base needs calculation ────────────────────────────────────────────────

function calcBaseNeeds(base, gamedata) {
  const recipeMap     = new Map(gamedata.recipes.map(r => [r.id, r]));
  const matMap        = new Map(gamedata.materials.map(m => [m.id, m]));
  const warehouseAmts = new Map((base.warehouse?.mats ?? []).map(m => [m.id, m.am]));

  // Production inputs
  const recipeGroups = new Map(); // rId → { recipe, totalMul, cyclesPerDay }
  for (const slot of base.buildingSlots ?? []) {
    if (slot.status !== 2 || !slot.building?.task) continue;
    const task    = slot.building.task;
    const recipe  = recipeMap.get(task.rId);
    if (!recipe) continue;
    const cycleMs      = new Date(task.comD) - new Date(task.startDate);
    if (cycleMs <= 0) continue;
    const cyclesPerDay = (24 * 60 * 60 * 1000) / cycleMs;
    if (!recipeGroups.has(task.rId)) {
      recipeGroups.set(task.rId, { recipe, totalMul: 0, cyclesPerDay });
    }
    recipeGroups.get(task.rId).totalMul += (slot.building.level ?? 1);
  }

  const inputs = [];
  for (const { recipe, totalMul, cyclesPerDay } of recipeGroups.values()) {
    for (const inp of (recipe.inputs ?? [])) {
      const dailyNeed = inp.am * totalMul * cyclesPerDay;
      const inStock   = warehouseAmts.get(inp.id) ?? 0;
      const days      = dailyNeed > 0 ? inStock / dailyNeed : Infinity;
      inputs.push({
        matId: inp.id,
        name:  matMap.get(inp.id)?.sName ?? `mat${inp.id}`,
        dailyNeed, inStock, days,
      });
    }
  }

  // Worker consumables
  const consumables = (base.workforce?.consumptionMaterials ?? []).map(c => {
    const inStock = warehouseAmts.get(c.matId) ?? 0;
    const days    = c.rate > 0 ? inStock / c.rate : Infinity;
    return {
      matId: c.matId,
      name:  matMap.get(c.matId)?.sName ?? `mat${c.matId}`,
      dailyNeed: c.rate, inStock, days,
      isEating: c.isEating,
    };
  });

  return { inputs, consumables };
}

// ── Panel builder ─────────────────────────────────────────────────────────────

function buildPanel(bases, gamedata) {
  const panel = document.createElement('div');
  panel.id = PROD_PANEL_ID;
  Object.assign(panel.style, {
    position: 'fixed', bottom: '48px', right: '12px',
    width: '340px', maxHeight: '70vh', overflowY: 'auto',
    background: '#0d0d1f', border: '1px solid #2a2a4a', borderRadius: '8px',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#b0b0cc',
    zIndex: '2147483646', padding: '10px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
  });

  panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <span style="color:#d1d5db;font-weight:600;font-size:13px;">Production Tracker</span>
    <span id="gt-prod-refresh" style="color:#6b6b8a;font-size:14px;cursor:pointer;" title="Refresh data">&#8635;</span>
  </div>`;

  for (const base of bases) {
    const { inputs, consumables } = calcBaseNeeds(base, gamedata);
    const allDays  = [...inputs, ...consumables].map(r => r.days).filter(d => isFinite(d));
    const worstDay = allDays.length ? Math.min(...allDays) : Infinity;
    const headerCol = daysColour(worstDay);

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:8px;border:1px solid #1e1e3a;border-radius:5px;overflow:hidden;';

    const header = document.createElement('div');
    header.className = 'gt-base-header';
    header.style.cssText = 'padding:6px 8px;background:#111128;cursor:pointer;display:flex;align-items:center;justify-content:space-between;';
    header.innerHTML = `<span style="color:#d1d5db;font-weight:500;">${base.name}</span>
      <span style="color:${headerCol};font-size:10px;">&#9679;</span>`;

    const body = document.createElement('div');
    body.style.cssText = 'padding:6px 8px;';

    const renderRows = (items, heading) => {
      if (!items.length) return '';
      let html = `<div style="color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin:4px 0 3px;">${heading}</div>`;
      for (const r of items) {
        const col     = daysColour(r.days);
        const daysStr = isFinite(r.days) ? r.days.toFixed(1) + 'd' : '&#8734;';
        const needStr = Math.round(r.dailyNeed).toLocaleString() + '/day';
        html += `<div style="display:grid;grid-template-columns:1fr auto auto;gap:4px;align-items:center;padding:2px 0;border-bottom:1px solid #1a1a2e;">
          <span style="color:#c0c0da;">${r.name}</span>
          <span style="color:#6b6b8a;font-size:10px;">${needStr}</span>
          <span style="color:${col};font-size:11px;font-weight:600;min-width:32px;text-align:right;">${daysStr}</span>
        </div>`;
      }
      return html;
    };

    body.innerHTML = renderRows(inputs, 'Production Inputs') +
                     renderRows(consumables, 'Worker Consumables');

    header.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    section.appendChild(header);
    section.appendChild(body);
    panel.appendChild(section);
  }

  return panel;
}

// ── Production button ─────────────────────────────────────────────────────────

function injectProductionButton() {
  if (document.getElementById(PROD_BUTTON_ID)) return;
  const btn = document.createElement('button');
  btn.id = PROD_BUTTON_ID;
  btn.textContent = '\u2699 Production';
  Object.assign(btn.style, {
    position: 'fixed', bottom: '12px', right: '12px',
    background: '#111128', border: '1px solid #2a2a4a', borderRadius: '6px',
    color: '#b0b0cc', fontFamily: 'system-ui, sans-serif', fontSize: '12px',
    padding: '6px 12px', cursor: 'pointer', zIndex: '2147483647',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  });
  btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4a4a6a'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a2a4a'; });
  btn.addEventListener('click', toggleProductionPanel);
  document.body.appendChild(btn);
}

// ── Panel toggle ──────────────────────────────────────────────────────────────

async function toggleProductionPanel() {
  const existing = document.getElementById(PROD_PANEL_ID);
  if (existing) { existing.remove(); return; }

  // Loading placeholder
  const loading = document.createElement('div');
  loading.id = PROD_PANEL_ID;
  Object.assign(loading.style, {
    position: 'fixed', bottom: '48px', right: '12px', width: '220px',
    background: '#0d0d1f', border: '1px solid #2a2a4a', borderRadius: '8px',
    padding: '14px 16px', color: '#6b6b8a',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', zIndex: '2147483646',
  });
  loading.textContent = 'Loading bases\u2026';
  document.body.appendChild(loading);

  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      loading.textContent = 'No API key \u2014 set one in the extension popup.';
      loading.style.color = '#ef4444';
      return;
    }
    const [bases, gamedata] = await Promise.all([fetchBases(apiKey), loadGamedata()]);
    loading.remove();
    const panel = buildPanel(bases, gamedata);
    document.body.appendChild(panel);

    document.getElementById('gt-prod-refresh')?.addEventListener('click', () => {
      _basesCache = { data: null, ts: 0 };
      document.getElementById(PROD_PANEL_ID)?.remove();
      toggleProductionPanel();
    });
  } catch (err) {
    loading.textContent = `Error: ${err.message}`;
    loading.style.color = '#ef4444';
  }
}

// ── Hook into run() and storage change handler ────────────────────────────────
// The production button is injected on all game pages when enabled.
// Re-wire run() to also inject the button (call after initial run() at top).

(function initProductionTracker() {
  chrome.storage.local.get('enabled', ({ enabled }) => {
    if (enabled !== false) injectProductionButton();
  });
})();

// Extend existing storage change listener to also manage the production button/panel.
chrome.storage.onChanged.addListener((changes) => {
  if (!('enabled' in changes)) return;
  if (changes.enabled.newValue === false) {
    document.getElementById(PROD_PANEL_ID)?.remove();
    document.getElementById(PROD_BUTTON_ID)?.remove();
  } else {
    injectProductionButton();
  }
});
