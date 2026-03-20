const GT_TRACK = 'https://galactic-track.com';
const INJECT_ID = 'gt-guild-row';
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

// ── Tooltip ───────────────────────────────────────────────────────────────────

const STOCK_LABELS = { high: 'High', low: 'Low', to_order: 'To Order' };
const STOCK_COLORS = { high: '#22c55e', low: '#f59e0b', to_order: '#a78bfa' };

function removeTooltip() {
  document.getElementById(TOOLTIP_ID)?.remove();
}

function showTooltip(anchor, listing) {
  removeTooltip();
  if (!listing.stock_level && !listing.location) return;

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
    'line-height:1.6',
  ].join(';');

  if (listing.stock_level) {
    const label = STOCK_LABELS[listing.stock_level] || listing.stock_level;
    const color = STOCK_COLORS[listing.stock_level] || '#b0b0cc';

    const stockLabel = document.createElement('span');
    stockLabel.style.color = '#6b7280';
    stockLabel.textContent = 'Stock: ';

    const stockValue = document.createElement('span');
    stockValue.style.color = color;
    stockValue.textContent = label;

    tip.appendChild(stockLabel);
    tip.appendChild(stockValue);
  }

  if (listing.location) {
    if (listing.stock_level) tip.appendChild(document.createElement('br'));

    const locLabel = document.createElement('span');
    locLabel.style.color = '#6b7280';
    locLabel.textContent = 'Location: ';

    tip.appendChild(locLabel);
    tip.appendChild(document.createTextNode(listing.location));
  }

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
      const span = document.createElement('span');
      span.style.cssText = 'margin-right:14px;white-space:nowrap;cursor:default';

      const labelEl = document.createElement('span');
      labelEl.style.color = '#6b7280';
      labelEl.textContent = `[${gTag}] ${l.company_name}:`;

      const priceEl = document.createElement('span');
      priceEl.style.cssText = 'color:#d1d5db;font-weight:500;margin-left:5px';
      priceEl.textContent = fmtPrice(l.price_type, l.price_value);

      span.appendChild(labelEl);
      span.appendChild(priceEl);

      if (l.stock_level || l.location) {
        span.addEventListener('mouseenter', () => showTooltip(span, l));
        span.addEventListener('mouseleave', removeTooltip);
      }

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

async function run() {
  removeInjection();
  if (tableObserver) { tableObserver.disconnect(); tableObserver = null; }

  const matId = getMatIdFromUrl();
  if (!matId) return;

  const { gTag } = await chrome.storage.local.get('gTag');
  if (!gTag) return;

  try {
    const all = await fetchListings(gTag);
    const listings = all.filter(l => l.mat_id === Number(matId));
    waitForTable(listings, gTag);
  } catch { /* silent fail */ }
}

// ── SPA navigation ────────────────────────────────────────────────────────────

let lastUrl = location.href;

new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  if (location.pathname.startsWith('/exchange/')) {
    run();
  } else {
    removeInjection();
  }
}).observe(document.body, { subtree: true, childList: true });

run();
