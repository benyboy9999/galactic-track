const GT_TRACK = 'https://galactic-track.com';
const GT_API   = 'https://api.g2.galactictycoons.com';
const INJECT_ID  = 'gt-guild-row';
const TOOLTIP_ID = 'gt-tooltip';
const GT_PANEL_WISHLIST_ID     = 'gt-panel-wishlist';
const GT_PANEL_WISHLIST_BTN_ID = 'gt-panel-wishlist-btn';
const GT_FLIGHT_ID             = 'gt-flight-panel';
const SERVER_SHIP_SPEED        = 4;

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

// ── Local API helper ──────────────────────────────────────────────────────────

function requestGTLocalAPI(action, params = {}, timeoutMs = 3000) {
  return new Promise(resolve => {
    const reqId = `gt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, timeoutMs);
    function handler(event) {
      if (event.source !== window) return;
      const d = event.data;
      if (d?.type !== 'GT_LAPI_RESPONSE' || d?.requestId !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      if (!d.success) { resolve(null); return; }
      try { resolve(typeof d.data === 'string' ? JSON.parse(d.data) : (d.data ?? null)); }
      catch { resolve(null); }
    }
    window.addEventListener('message', handler);
    window.postMessage({ type: 'GT_LAPI_REQUEST', requestId: reqId, action, params }, '*');
  });
}

// ── Identity (Local API auto-connect) ─────────────────────────────────────────

const IDENTITY_TTL = 24 * 60 * 60 * 1000;

async function resolveIdentity() {
  const cached = await chrome.storage.local.get(['gTag', 'companyName', 'gTagTs']);
  if (cached.gTag && Date.now() - (cached.gTagTs ?? 0) < IDENTITY_TTL) return cached;

  // Get company name from local API, gTag from guild data (fetched on page load)
  const [company, guild] = await Promise.all([
    requestGTLocalAPI('getMyCompany'),
    fetchGuildData(),
  ]);
  const companyName = company?.name ?? '';
  const gTag = guild?.tag ?? guild?.gTag ?? guild?.guild_tag ?? '';
  if (gTag) {
    chrome.storage.local.set({ gTag, companyName, gTagTs: Date.now() });
    return { gTag, companyName };
  }

  return null;
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

function inject(target, listings, gTag) {
  removeInjection();

  const wrap = document.createElement('div');
  wrap.id = INJECT_ID;
  wrap.style.cssText = [
    'padding:6px 0 4px',
    'border-top:1px solid rgba(255,255,255,0.06)',
    'font-size:13px',
    'line-height:1.6',
    'display:flex',
    'flex-wrap:wrap',
    'gap:4px 14px',
    'align-items:center',
  ].join(';');

  if (listings.length === 0) {
    const empty = document.createElement('span');
    empty.style.cssText = 'color:#4b5563;font-style:italic';
    empty.textContent = 'No guild listings';
    wrap.appendChild(empty);
  } else {
    listings.forEach(l => {
      const best = lowestPrice(l.locations);
      if (!best) return;

      const span = document.createElement('span');
      span.style.cssText = 'white-space:nowrap;cursor:default';

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

      span.addEventListener('mouseenter', () => { if (_settings.showTooltips) showTooltip(span, l); });
      span.addEventListener('mouseleave', removeTooltip);

      wrap.appendChild(span);
    });
  }

  target.appendChild(wrap);
}

// ── Wait for the exchange box-section to appear (SPA load) ────────────────────

let tableObserver = null;

function findExchangeTarget() {
  return document.querySelector('.box-section.p-2.mb-1');
}

function waitForTable(listings, gTag) {
  if (tableObserver) { tableObserver.disconnect(); tableObserver = null; }

  const existing = findExchangeTarget();
  if (existing) { inject(existing, listings, gTag); return; }

  let timeout = null;
  tableObserver = new MutationObserver(() => {
    const target = findExchangeTarget();
    if (!target) return;
    tableObserver.disconnect();
    tableObserver = null;
    clearTimeout(timeout);
    inject(target, listings, gTag);
  });

  tableObserver.observe(document.body, { subtree: true, childList: true });
  timeout = setTimeout(() => {
    if (tableObserver) { tableObserver.disconnect(); tableObserver = null; }
    console.warn('[GT] Exchange target (.card-body .box-section) not found after 10s');
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
  if (!_settings.showGuildPrices) return;

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
    console.log(`[GT] Fetched ${all.length} guild listings for tag="${gTag}", ${listings.length} match mat_id=${matId}`);
    waitForTable(listings, gTag);
  } catch (e) { console.warn('[GT] Price injection failed:', e); }
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

// Interval fallback needed because history.pushState (used by the game's React router)
// does not fire popstate, so we poll at a low frequency alongside the popstate listener.
let _lastPath = location.pathname;
setInterval(() => {
  if (location.pathname === _lastPath) return;
  _lastPath = location.pathname;
  onNavigate();
}, 1000);

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

const GT_HEADER_ID    = 'gt-prod-header';
const GT_CHIPAREA_ID  = 'gt-chip-area';
const GT_DETAIL_ID    = 'gt-prod-detail';
const GT_SPACER_ID    = 'gt-prod-spacer';
const GT_SETTINGS_ID      = 'gt-prod-settings';
const GT_CUSTOM_PRICES_ID = 'gt-custom-prices-modal';
const GT_TOAST_ID         = 'gt-prod-toast';
const GT_TAB_ID           = 'gt-prod-tab';
const GT_CASH_ID          = 'gt-cash-panel';
const GT_SUMMARY_ID       = 'gt-summary-panel';
const GT_WISHLIST_ALL_ID  = 'gt-wishlist-all-panel';
const BASES_CACHE_TTL = 5 * 60 * 1000; // 5 min

// ── SVG sprite / material icons ───────────────────────────────────────────────

let _spriteUrl  = null;
const _pendingIconUses = []; // <use> elements created before _spriteUrl was known

function _resolveSpriteUrl(url) {
  if (_spriteUrl) return;
  _spriteUrl = url.split('#')[0]; // strip fragment — we append our own #iconId
  // Retroactively fill in any icons already in the DOM
  for (const use of _pendingIconUses) {
    const id = use.getAttribute('data-gt-icon');
    if (id) use.setAttribute('href', `${url}#${id}`);
  }
  _pendingIconUses.length = 0;
}

function loadSprite() {
  if (_spriteUrl) return;

  const spriteRe = /\/assets\/sprite-[A-Za-z0-9_-]+\.svg/;

  // 1. Check performance buffer — works for non-cached loads.
  for (const e of performance.getEntriesByType('resource')) {
    if (spriteRe.test(e.name)) { _resolveSpriteUrl(e.name); return; }
  }

  // 2. PerformanceObserver — catches the load if sprite hasn't loaded yet.
  try {
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (spriteRe.test(e.name)) { _resolveSpriteUrl(e.name); obs.disconnect(); }
      }
    });
    obs.observe({ type: 'resource', buffered: false });
  } catch { /* unavailable */ }

  // 3. Fetch main bundle to extract sprite filename — handles cached users where the
  //    sprite never appears in performance entries and PerformanceObserver never fires.
  //    Game loads via <link rel=modulepreload> not <script src>.
  //    Bundle is already cached so this fetch is instant with no network request.
  const mainLink = [...document.querySelectorAll('link[rel=modulepreload]')]
    .find(l => l.href.includes('/assets/main-'));
  if (mainLink) {
    fetch(mainLink.href)
      .then(r => r.ok ? r.text() : null)
      .then(js => {
        if (!js || _spriteUrl) return;
        const m = js.match(/\/assets\/sprite-[A-Za-z0-9_-]+\.svg/);
        if (m) _resolveSpriteUrl(`https://g2.galactictycoons.com${m[0]}`);
      })
      .catch(() => {});
  }
}

const ICON_OVERRIDES = {
  // From materialIcon.ts (canonical)
  'Ale':'Ale',
  'Amenities':'BasicAmenities','Advanced Amenities':'AdvancedAmenities',
  'Bio-Nutrient Blend':'NutrientBlend','Nutrient Blend':'NutrientBlend',
  'Chickens':'Chicken','Cows':'Cow',
  'Copper':'CopperBar','Copper Wire':'CopperWiring',
  'Electric Motor':'Motor',
  'Ethanol':'Gasoline',
  'Hull Plate':'BasicHullPlate',
  'Iron':'IronBar',
  'Prefab Kit':'BasicPrefabKit','Modern Prefab Kit':'ModernPrefabKit','Advanced Prefab Kit':'AdvancedPrefabKit',
  'Field Cooling System':'FieldCooling','Field Cooling':'FieldCooling',
  'TiC Drill':'AdvancedDrill','Titanium Carbide Drill':'AdvancedDrill',
  'APU':'APU','Advanced Processing Unit':'APU',
  'Advanced Tools':'AdvancedTools','Adv. Tools':'AdvancedTools',
  'AI':'AI','Artificial Intelligence':'AI',
  'Research':'ResearchData','Research Data':'ResearchData',
  'Advanced Research':'AdvancedResearchData','Advanced Research Data':'AdvancedResearchData',
  'Adv. Research Data':'AdvancedResearchData',
  'Apex Research':'ApexResearchData','Apex Research Data':'ApexResearchData',
  'Quantum Research':'QuantumResearchData','Quantum Research Data':'QuantumResearchData',
  'Graphenium Wire':'Superconductors',
  'SuperCoil':'HyperCoil','Superconducting Coil':'HyperCoil',
  'Starglass Hull Plate':'QuadraniumHullPlate',
  'Molecular Fusion Kit':'WeldingKit2',
  'Hydrogen Fuel':'HydrogenFuelCell',
  'Ship Repair Kit':'ShipRepairKit',
  'Linear FTL Emitter':'BasicFTLEmitter',
  'Quantum FTL Emitter':'AdvancedFTLEmitter',
  'Extra-dimensional FTL Emitter':'SuperiorFTLEmitter',
  'Shuttle Bridge':'BasicShipBridge','Hauler Bridge':'AdvancedShipBridge','Freighter Bridge':'T4ShipBridge',
  'Starlifter Structural Elements':'T4ShipElements',
  'Construction Kit':'BasicConstructionKit',
  'Consumer Electronics':'Electronics',
  'Truss':'ReinforcedTruss',
  'Rations':'BasicRations','Fine Rations':'FineRations',
  'Tools':'BasicTools',
  'Exosuit':'BasicExosuit',
  'Nanites':'Nanobots',
  'Pump':'BasicPump',
  'Lab Suit':'LaboratorySuit','Laboratory Suit':'LaboratorySuit','Lab. Suit':'LaboratorySuit',
  'Assembly Plant':'BasicAssemblyPlant',
  'Chemical Plant':'ChemistryPlant',
  'Micronics Factory':'MicroelectronicsFactory',
  'Quantum Nexus':'QuantumComputingCenter',
  // Extension extras
  'Fusion Kit':'WeldingKit2',
  'Cargo Bay':'CargoBaySegment','Cargo Bay Segment':'CargoBaySegment',
  'Tiridium':'TiridiumAlloy','Tiridium Alloy':'TiridiumAlloy',
  'Tiridium Plate':'TiridiumHullPlate','Tiridium Hull Plate':'TiridiumHullPlate',
  'Silicon Wafer':'SiliconWafer',
  'Repair Kit':'ShipRepairKit',
  'Medicine Shipment':'Pack_Medicine','Food Shipment':'Pack_Food',
  'Ship Parts Shipment':'Pack_ShipParts','Defense systems pack':'Pack_Defense',
  'Habitats Shipment':'Pack_Habitats',
  'Scientific Instruments Shipment':'Pack_Scientific','Gifts':'Pack_Gifts',
  // Short-name aliases (sName values that may be stored in wishlists or passed from old data)
  '4D Emitter':'SuperiorFTLEmitter',
  'Fuel Tank':'FuelTankSegment','Fuel Tank Segment':'FuelTankSegment',
  'QFE':'AdvancedFTLEmitter','FTL Emitter':'BasicFTLEmitter',
};

function toIconId(name) {
  if (!name) return '';
  if (ICON_OVERRIDES[name]) return ICON_OVERRIDES[name];
  return name.replace(/[^a-zA-Z0-9 ]/g, '').split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function makeIcon(matName, size = 14) {
  const id = toIconId(matName);
  if (!id) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `width:${size}px;height:${size}px;vertical-align:middle;flex-shrink:0;display:inline-block;`;
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  if (_spriteUrl) {
    use.setAttribute('href', `${_spriteUrl}#${id}`);
  } else {
    use.setAttribute('data-gt-icon', id);
    _pendingIconUses.push(use);
  }
  svg.appendChild(use);
  return svg;
}

const HEADER_H = 38; // px
// Height of the game's fixed bottom navbar — measured at runtime to avoid clipping
function getGameBottomNavH() {
  const el = document.querySelector('nav.navbar.fixed-bottom, .navbar.fixed-bottom, nav[class*="bottom"]');
  return el ? el.getBoundingClientRect().height : 0;
}

const COL_OK   = '#22c55e';
const COL_LOW  = '#f59e0b';
const COL_CRIT = '#ef4444';
// Thresholds come from _settings (hours); d is in days
function daysColour(d) {
  const h = d * 24;
  return h >= _settings.lowHours ? COL_OK : h >= _settings.critHours ? COL_LOW : COL_CRIT;
}
function fmtDays(d) {
  if (!isFinite(d)) return '\u221e';
  if (d < 1) return (d * 24).toFixed(1) + 'h';
  return d.toFixed(1) + 'd';
}

function _debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── Contracts pinning ─────────────────────────────────────────────────────────
const GT_PINNED_CONTRACTS_KEY = 'gt-pinned-contracts';
const _getPinnedContracts = () => {
  try { return new Set(JSON.parse(localStorage.getItem(GT_PINNED_CONTRACTS_KEY) ?? '[]')); }
  catch { return new Set(); }
};
const _setPinnedContracts = set =>
  localStorage.setItem(GT_PINNED_CONTRACTS_KEY, JSON.stringify([...set]));

const _contractRowKey = tr => {
  const tds = [...tr.querySelectorAll('td')];
  const type    = tds[0]?.firstChild?.textContent?.trim() ?? '';
  const date    = tds[1]?.querySelector('div')?.textContent?.trim() ?? '';
  const partner = tds[2]?.textContent?.trim().slice(0, 30) ?? '';
  const mat     = tds[4]?.textContent?.trim().slice(0, 30) ?? '';
  return [type, date, partner, mat].join('|').replace(/\s+/g, '');
};

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  targetDays:         1,
  critHours:          6,   // below this → red
  lowHours:           18,  // below this → amber; above → green
  includeStock:       true,
  includeInputs:      true,
  includeConsumables: true,
  hiddenBases:        [],
  baseOrder:          [],     // ordered array of base ID strings; empty = default sort
  sortByTimeLeft:     false,  // when true, sort chips/list by worstDay ascending
  priceMode:          'current', // 'current' | 'average'
  customPrices:       {},        // { [matId]: priceInDollars }
  // Feature visibility
  showGTE:          true,
  showSummary:      true,
  showAssets:       true,
  showWishlist:     true,
  showWishlistAll:  true,
  showWishlistPanel: true,
  showGuildPrices:  true,
  showCosts:        true,
  showTooltips:     true,
  showFlights:      true,
  showFlightCosts:  true,
  disableScrap:     true,
  disableHotkeys:   false,
};

let _settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['gtSettings'], ({ gtSettings }) => {
      _settings = { ...DEFAULT_SETTINGS, ...(gtSettings ?? {}) };
      resolve(_settings);
    });
  });
}

function saveSettings() {
  chrome.storage.local.set({ gtSettings: _settings });
}

// ── Panel Wishlist state & storage ────────────────────────────────────────────

let _panelWishlistOpen = false;

function loadPanelWishlist() {
  return new Promise(resolve => {
    chrome.storage.local.get(['gtPanelWishlist'], ({ gtPanelWishlist }) => resolve(gtPanelWishlist ?? {}));
  });
}
function savePanelWishlist(data) {
  chrome.storage.local.set({ gtPanelWishlist: data });
}
async function addToPanelWishlist(base, mats) {
  // mats: [{id, am}]  — names resolved from _loadedHeaderGamedata
  const data = await loadPanelWishlist();
  const key  = String(base.id);
  if (!data[key]) data[key] = { baseName: base.name, items: [] };
  for (const m of mats) {
    const matName = _loadedHeaderGamedata?.materials?.find(x => x.id === m.id)?.name ?? `mat${m.id}`;
    const existing = data[key].items.find(i => i.id === m.id);
    if (existing) existing.am += m.am;
    else data[key].items.push({ id: m.id, name: matName, am: m.am });
  }
  savePanelWishlist(data);
}
async function clearPanelItem(baseId, matId) {
  const data = await loadPanelWishlist();
  const key  = String(baseId);
  if (!data[key]) return;
  data[key].items = data[key].items.filter(i => i.id !== matId);
  if (!data[key].items.length) delete data[key];
  savePanelWishlist(data);
}
async function clearPanelBase(baseId) {
  const data = await loadPanelWishlist();
  delete data[String(baseId)];
  savePanelWishlist(data);
}
function clearPanelAll() {
  savePanelWishlist({});
}

// ── Gamedata loader ───────────────────────────────────────────────────────────

let _gamedata = null;
async function loadGamedata() {
  if (_gamedata) return _gamedata;
  const url  = chrome.runtime.getURL('data/gamedata.json');
  const resp = await fetch(url);
  _gamedata  = await resp.json();
  return _gamedata;
}

// ── Extended API key reader ───────────────────────────────────────────────────

async function getExtApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['gtExtApiKey'], ({ gtExtApiKey }) => resolve(gtExtApiKey ?? null));
  });
}

// ── Bases fetch (5-min cache) ─────────────────────────────────────────────────

let _basesCache = { data: null, ts: 0 };
async function fetchBases() {
  if (_basesCache.data && Date.now() - _basesCache.ts < BASES_CACHE_TTL) {
    return _basesCache.data;
  }
  const company = await requestGTLocalAPI('getMyCompany');
  const stubs = company?.bases ?? company?.buildingBases ?? (Array.isArray(company) ? company : null);
  if (!Array.isArray(stubs) || !stubs.length) return [];

  // Fetch full detail for each base via getBase(baseId)
  const detailed = await Promise.all(
    stubs.map(async (stub) => {
      const id = stub.id ?? stub.baseId;
      if (!id) return stub; // fallback: use stub as-is
      const full = await requestGTLocalAPI('getBase', { baseId: id });
      if (full) return full;
      return stub;
    })
  );

  _basesCache = { data: detailed, ts: Date.now() };
  return detailed;
}

// ── Guild data cache ──────────────────────────────────────────────────────────

let _guildData   = null;
let _guildDataTs = 0;
const GUILD_TTL  = 60 * 60 * 1000; // 1 hour

async function fetchGuildData() {
  if (_guildData && Date.now() - _guildDataTs < GUILD_TTL) return _guildData;
  const apiKey = await getExtApiKey();
  if (!apiKey) return null;
  try {
    const r = await fetch(`${GT_API}/public/guild?apikey=${encodeURIComponent(apiKey)}`);
    if (!r.ok) return null;
    _guildData   = await r.json();
    _guildDataTs = Date.now();
    // Cache gTag from guild response so resolveIdentity doesn't need a separate detail call
    const gTag = _guildData?.tag ?? _guildData?.gTag ?? _guildData?.guild_tag ?? '';
    if (gTag) {
      const cached = await chrome.storage.local.get(['gTag', 'companyName']);
      if (!cached.gTag) {
        chrome.storage.local.set({ gTag, companyName: cached.companyName ?? '', gTagTs: Date.now() });
      }
    }
    return _guildData;
  } catch { return null; }
}

// ── Company data cache ────────────────────────────────────────────────────────

let _companyData    = null;
let _companyDataTs  = 0;
let _perksLoaded    = false;
let _guildLoaded    = false;
const COMPANY_TTL   = 5 * 60 * 1000;

let _syncOverflowBadge = null; // set by loadAndInjectHeader; called after chip refresh

// Refresh local API data only — no GT API / API key calls.
async function refreshLocalCompanyData() {
  const local = await requestGTLocalAPI('getMyCompany');
  if (local?.id) {
    // Preserve already-loaded perks across local refreshes
    const perks = _companyData?.perks;
    _companyData   = perks ? { ...local, perks } : local;
    _companyDataTs = Date.now();
  }
}

// Bust bases + price caches and rebuild header chips in-place.
async function refreshChips() {
  await refreshLocalCompanyData();
  _basesCache = { data: null, ts: 0 };
  _pricesCache = { data: null, ts: 0 };
  const chipArea = document.getElementById(GT_CHIPAREA_ID);
  if (!chipArea || !_loadedHeaderGamedata) return;
  const bases = await fetchBases();
  _loadedHeaderBases = bases;
  await fetchMatPrices();
  // Remove old chips, keep overflow badge (always last child)
  const overflowBadge = chipArea.lastElementChild;
  for (const chip of [...chipArea.querySelectorAll('[data-base-id]')]) chip.remove();
  const sorted = sortBases(bases, _loadedHeaderGamedata).filter(b => !_settings.hiddenBases.includes(String(b.id)));
  for (const base of sorted) chipArea.insertBefore(buildHeaderChip(base, _loadedHeaderGamedata), overflowBadge);
  _syncOverflowBadge?.();
}

// Full fetch — local API + perks from GT API (on first load / explicit refresh only).
async function fetchCompanyData() {
  if (_companyData && Date.now() - _companyDataTs < COMPANY_TTL) return _companyData;
  const local = await requestGTLocalAPI('getMyCompany');
  if (local?.id) {
    _companyData = local; _companyDataTs = Date.now();
    // Perks and guild data fetched once per page load — never on the periodic timer.
    if (!_perksLoaded) {
      _perksLoaded = true;
      getExtApiKey().then(async apiKey => {
        if (!apiKey) return;
        try {
          const resp = await fetch(`${GT_API}/public/company?apikey=${encodeURIComponent(apiKey)}`);
          if (!resp.ok) return;
          const apiData = await resp.json();
          if (Array.isArray(apiData?.perks)) {
            _companyData = { ..._companyData, perks: apiData.perks };
          }
        } catch { /* non-critical — speed calc falls back to research-only */ }
      });
    }
    if (!_guildLoaded) {
      _guildLoaded = true;
      fetchGuildData().catch(() => {});
    }
    return local;
  }
  // No local API (not logged in) — fetch directly from GT API
  const apiKey = await getExtApiKey();
  if (!apiKey) return null;
  try {
    const resp = await fetch(`${GT_API}/public/company?apikey=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) return null;
    _companyData = await resp.json();
    _companyDataTs = Date.now();
    return _companyData;
  } catch { return null; }
}

// ── Market price cache ────────────────────────────────────────────────────────

let _priceMap = null;
let _priceMapTs = 0;
const PRICE_TTL = 10 * 60 * 1000; // 10 min

// All prices from the game API are in cents — divide by 100
function extractPriceMap(raw) {
  const map = new Map();
  if (!raw) return map;
  // Array format: [{matId/id, minSell/sell/price/...}, ...]
  const arr = raw.prices ?? (Array.isArray(raw) ? raw : null);
  if (arr) {
    for (const p of arr) {
      const id    = Number(p.matId ?? p.id);
      const pCents = p.currentPrice ?? p.avgPrice ?? p.minSell ?? p.sell ?? p.minPrice ?? p.price ?? p.unitPrice ?? p.avg ?? 0;
      const cents = pCents > 0 ? pCents : 0; // -1 means no data in local API
      if (id && cents) map.set(id, cents / 100);
    }
    return map;
  }
  // Object format: { "2": 15000, "3": { price: 8000 }, ... }
  if (typeof raw === 'object') {
    for (const [key, val] of Object.entries(raw)) {
      const id = Number(key);
      if (!id) continue;
      const cents = typeof val === 'number' ? val
        : (val.minSell ?? val.sell ?? val.price ?? val.unitPrice ?? 0);
      if (cents) map.set(id, cents / 100);
    }
  }
  return map;
}

async function fetchMatPrices() {
  if (_priceMap && Date.now() - _priceMapTs < PRICE_TTL) return _priceMap;
  const localPrices = await requestGTLocalAPI('getPrices');
  if (!localPrices) return _priceMap ?? null;
  const map = extractPriceMap(localPrices);
  if (map.size > 0) { _priceMap = map; _priceMapTs = Date.now(); }
  return _priceMap ?? null;
}

// Fetch a single material's current lowest sell price via mat-details/{id}.
// Merges result into _priceMap so effectivePrice() picks it up.
const _matDetailFetching = new Set();
async function fetchMatDetailPrice(matId) {
  const id = Number(matId);
  if (!id) return 0;
  if (_priceMap?.has(id)) return _priceMap.get(id);
  if (_matDetailFetching.has(id)) return 0;
  _matDetailFetching.add(id);
  // Refresh price map from local API — the item may have appeared since last fetch
  await fetchMatPrices();
  _matDetailFetching.delete(id);
  return _priceMap?.get(id) ?? 0;
}

// ── Average price cache ───────────────────────────────────────────────────────

let _avgPriceMap   = null;
let _avgPriceMapTs = 0;
const AVG_PRICE_TTL = 30 * 60 * 1000; // 30 min

async function fetchAvgPrices() {
  if (_avgPriceMap && Date.now() - _avgPriceMapTs < AVG_PRICE_TTL) return _avgPriceMap;
  // Local API getPrices returns avgPrice per material — build avg map from it
  const localPrices = await requestGTLocalAPI('getPrices');
  const arr = localPrices?.prices ?? (Array.isArray(localPrices) ? localPrices : null);
  if (!arr) return _avgPriceMap ?? null;
  const map = new Map();
  for (const m of arr) {
    const id  = Number(m.matId ?? m.id);
    const avg = Number(m.avgPrice ?? m.avg ?? 0);
    if (id && avg > 0) map.set(id, avg / 100);
  }
  if (map.size > 0) { _avgPriceMap = map; _avgPriceMapTs = Date.now(); }
  return _avgPriceMap ?? null;
}

// Returns the effective price for a material, respecting custom overrides and priceMode.
// Falls back to average price when current price is unavailable (e.g. not on exchange mat-prices).
function effectivePrice(matId) {
  const id     = Number(matId);
  const custom = _settings.customPrices?.[id];
  if (custom != null && custom > 0) return custom;
  if (_settings.priceMode === 'average' && _avgPriceMap?.has(id)) return _avgPriceMap.get(id);
  return _priceMap?.get(id) ?? _avgPriceMap?.get(id) ?? 0;
}

// ── Planet factor ─────────────────────────────────────────────────────────────
// Returns the planet-specific speed factor for a recipe:
//   extraction buildings (spec 4): output material abundance / 100
//   farming buildings    (spec 3): planet fertility / 100
//   all other buildings           : 1 (no planet effect)

function getPlanetFactor(recipe, planet, gamedata) {
  if (!planet) return 1;
  const building = gamedata.buildings.find(b => b.id === recipe.producedIn);
  if (!building) return 1;
  if (building.specialization === 4) {
    const outId = recipe.output?.id;
    if (!outId) return 1;
    const mat = planet.mats?.find(m => m.id === outId);
    return mat ? mat.ab / 100 : 1;
  }
  if (building.specialization === 3) {
    return (planet.fert ?? 100) / 100;
  }
  return 1;
}

// ── Production speed multiplier ───────────────────────────────────────────────
// Returns the total speed multiplier for a given building specialization type.
// technology ID === building.specialization; each level = +5% production speed.
// Perk bonuses (type 7) apply to all building types but are only included when
// company.perks is available (GT API key path); local API omits perks.
// When active tasks exist for a building type, their actual cycle times are more
// accurate than this model — use speedRatioByType first, fall back to this.

function calcSpeedMultiplier(bType, companyData, gamedataPerks) {
  let bonus = 0;

  // Research: +5% per level, type-specific
  const tech = (companyData?.technologies ?? []).find(t => t.id === bType);
  if (tech?.level) bonus += tech.level * 0.05;

  // Perks: bonus type 7 = production speed %, applies to all building types
  const perkLevels = new Map((companyData?.perks ?? []).map(p => [p.id, p.lvl ?? p.level ?? 0]));
  for (const perk of (gamedataPerks ?? [])) {
    const lvl = perkLevels.get(perk.id) ?? 0;
    if (!lvl) continue;
    for (const b of (perk.bonuses ?? [])) {
      if (b.type === 7) bonus += (b.perLevel * lvl) / 100;
    }
  }

  // Starting bonus (new company age multiplier) — multiplicative on top of research/perk bonuses
  const startMult = companyStartingBonus(companyData?.fDate);

  return (1 + bonus) * startMult;
}

// ── Company age / starting bonus ─────────────────────────────────────────────

function companyStartingBonus(fDate) {
  if (!fDate) return 1;
  const ageHours = (Date.now() - new Date(fDate)) / 3600000;
  if (ageHours <   4) return 5;
  if (ageHours <  12) return 4;
  if (ageHours <  36) return 3;
  if (ageHours <  96) return 2;
  if (ageHours < 240) return 1.5;
  if (ageHours < 336) return 1.2;
  return 1;
}

// ── Flight calculation helpers ────────────────────────────────────────────────

function getSystemForPlanet(gamedata, planetId) {
  for (const sys of gamedata.systems ?? []) {
    if ((sys.planets ?? []).some(p => p?.id === planetId)) return sys;
  }
  return null;
}

function getPlanetById(gamedata, planetId) {
  for (const sys of gamedata.systems ?? []) {
    const p = (sys.planets ?? []).find(p => p?.id === planetId);
    if (p) return p;
  }
  return null;
}

function systemDistance(sysA, sysB) {
  const dx = sysA.x - sysB.x, dy = sysA.y - sysB.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function fmtFlightTime(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours), m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Ship configuration derivation ─────────────────────────────────────────────

function roundHalfUp(x) {
  return Math.floor(x + 0.5);
}

function applyShielding(weight, level) {
  // level: 1=None, 2=Light(+1.5%), 3=Heavy(+7%)
  if (level === 2) return weight * 1.015;
  if (level === 3) return weight * 1.07;
  return weight;
}

// Derives the full ship configuration from blueprint fields.
// Returns { reactorCount, reactorEfficiency, weightEmpty, fuelCapacity }
function calcShipConfig(blueprint, emitter, reactor) {
  const emitterCount = blueprint.emittersCount;
  const cargoCapacity = blueprint.cargoCapacity;
  const tankType     = blueprint.tankType ?? 1;   // 1=Small, 2=Medium, 3=Large
  const heatLevel    = blueprint.heatShielding ?? 1;
  const radLevel     = blueprint.radiationShielding ?? 1;

  // ── Reactor count (energy draw with diminishing returns after 4) ──
  const energyDraw = emitterCount * (emitter.energyDraw ?? 10);
  let reactorCount = 0;
  let remaining    = energyDraw;
  let dimSteps     = 0;
  while (remaining > 0) {
    const contrib = reactorCount < 4
      ? 1.0
      : Math.max(Math.pow(0.965, ++dimSteps), 0.35);
    remaining -= reactor.energy * contrib;
    reactorCount++;
  }
  if (reactorCount === 0) reactorCount = 1;

  // Efficiency = energy actually used / total energy capacity
  const energyGenerated = energyDraw - remaining; // remaining is ≤0 at loop exit
  const reactorEfficiency = energyGenerated / (reactorCount * reactor.energy);

  // ── Empty weight ──
  const cargoBays  = Math.ceil(cargoCapacity / 100);
  const baseWeight = 20
    + 25 * cargoBays
    + emitterCount * emitter.weight
    + reactorCount * reactor.weight
    + reactorCount * reactor.weight * 0.175 * tankType;
  const weightEmpty = roundHalfUp(applyShielding(applyShielding(baseWeight, heatLevel), radLevel));

  // ── Fuel capacity ──
  const fuelCapacity = Math.round(reactor.fuelCapacity * reactorCount * tankType * 0.5);

  return { reactorCount, reactorEfficiency, weightEmpty, fuelCapacity };
}

// ── Flight calculation ─────────────────────────────────────────────────────────

// Extract flight-relevant perk bonuses from companyData.
// Returns { cargoCapPct, degradationPct, fuelSavingPct, speedPct }
function calcFlightPerks(companyData, gamedataPerks) {
  const perkLevels = new Map((companyData?.perks ?? []).map(p => [p.id, p.lvl ?? p.level ?? 0]));
  let cargoCapPct = 0, degradationPct = 0, fuelSavingPct = 0, speedPct = 0;
  for (const perk of (gamedataPerks ?? [])) {
    const lvl = perkLevels.get(perk.id) ?? 0;
    if (!lvl) continue;
    for (const b of (perk.bonuses ?? [])) {
      if (b.type === 11) cargoCapPct    += b.perLevel * lvl;  // cargo capacity %
      if (b.type === 12) degradationPct += b.perLevel * lvl;  // ship degradation %
      if (b.type === 13) fuelSavingPct  += b.perLevel * lvl;  // fuel consumption %
      if (b.type === 27) speedPct        += b.perLevel * lvl;  // ship speed % (Haul and Crawl)
    }
  }
  return { cargoCapPct, degradationPct, fuelSavingPct, speedPct };
}

// Raw base travel time at a given pf, before speed multipliers.
// Used by fuel formula which needs baseTime at 50% power.
function calcBaseTime(distance, totalWeight, emitterCount, emitter, pf) {
  const ftlCapacity = emitterCount * (emitter.fieldCapacity ?? 1000) * pf;
  const weightRatio = totalWeight > 0 ? ftlCapacity / totalWeight : 1;
  let accel, maxSpd;
  if (weightRatio >= 1) {
    accel  = emitter.acceleration * weightRatio;
    maxSpd = emitter.maxSpeed * (1 + (weightRatio - 1) * 0.15);
  } else {
    accel  = emitter.acceleration * Math.pow(weightRatio, 1.7);
    maxSpd = emitter.maxSpeed * (1 - Math.pow(1 - weightRatio, 1.3));
  }
  const accelTime = maxSpd / accel;
  const accelDist = (accel * accelTime * accelTime) / 2;
  return distance <= accelDist
    ? Math.sqrt(2 * distance / accel)
    : accelTime + (distance - accelDist) / maxSpd;
}

// Returns { timeHours, fuelUsed, weightRatio, powerFraction, tankCapacity, weightEmpty, condWear }
// pf: explicit power fraction (0.2–1.0). opts: { fuelSavingMult, degradationMult }
function calcFlight(distance, ship, cargoWeight, emitter, reactor, speedMult, pf, opts = {}) {
  const { fuelSavingMult = 1, degradationMult = 1 } = opts;
  const blueprint    = ship.blueprint;
  const emitterCount = blueprint.emittersCount;

  const { weightEmpty, fuelCapacity, reactorCount } = calcShipConfig(blueprint, emitter, reactor);
  const tankCapacity = fuelCapacity;
  const totalWeight  = weightEmpty + cargoWeight;

  // Resolve power fraction — if not given, find highest pf that fits within tank
  let powerFraction;
  if (pf !== undefined) {
    powerFraction = Math.max(0.2, Math.min(pf, 1.0));
  } else {
    powerFraction = 1.0;
    for (let step = 80; step >= 0; step--) {
      const testPF  = 0.20 + step * 0.01;
      const fuelEff = Math.max(0.01, 1.20 - testPF);
      const bt50    = calcBaseTime(distance, totalWeight, emitterCount, emitter, 0.50);
      const fuel    = (reactorCount * reactor.fuelConsumption / fuelEff) * bt50 * fuelSavingMult;
      if (fuel <= tankCapacity) { powerFraction = testPF; break; }
    }
  }

  // ── Time ──
  const ftlCapacity = emitterCount * (emitter.fieldCapacity ?? 1000) * powerFraction;
  const weightRatio = totalWeight > 0 ? ftlCapacity / totalWeight : 1;

  let accel, maxSpd;
  if (weightRatio >= 1) {
    accel  = emitter.acceleration * weightRatio;
    maxSpd = emitter.maxSpeed * (1 + (weightRatio - 1) * 0.15);
  } else {
    accel  = emitter.acceleration * Math.pow(weightRatio, 1.7);
    maxSpd = emitter.maxSpeed * (1 - Math.pow(1 - weightRatio, 1.3));
  }

  const accelTime = maxSpd / accel;
  const accelDist = (accel * accelTime * accelTime) / 2;
  const baseTime  = distance <= accelDist
    ? Math.sqrt(2 * distance / accel)
    : accelTime + (distance - accelDist) / maxSpd;

  const condMult  = Math.min((ship.condition ?? 1) + 0.2, 1.0);
  const timeHours = baseTime / condMult / SERVER_SHIP_SPEED / speedMult;

  // ── Fuel (dev formula): reactors × fuelRate / fuelEfficiency × baseTime@50pf ──
  // fuelEfficiency = 1 - (pf - 0.20) = 1.20 - pf
  const fuelEfficiency = Math.max(0.01, 1.20 - powerFraction);
  const baseTime50     = calcBaseTime(distance, totalWeight, emitterCount, emitter, 0.50);
  const fuelUsed       = Math.min(
    (reactorCount * reactor.fuelConsumption / fuelEfficiency) * baseTime50 * fuelSavingMult,
    tankCapacity
  );

  // ── Condition loss: 0.001 × SERVER_SHIP_SPEED = 0.004/hr, with shielding damage mult ──
  // Shielding level 1=None(0%), 2=Light(-10%), 3=Heavy(-20%) per heat/rad slot
  const heatLevel  = blueprint.heatShielding ?? 1;
  const radLevel   = blueprint.radiationShielding ?? 1;
  const heatRed    = heatLevel === 3 ? 0.20 : heatLevel === 2 ? 0.10 : 0;
  const radRed     = radLevel  === 3 ? 0.20 : radLevel  === 2 ? 0.10 : 0;
  const damageMult = Math.max(0, 1 - heatRed - radRed);
  const condWear   = Math.min(timeHours * 0.004 * damageMult * degradationMult, ship.condition ?? 1);

  return { timeHours, fuelUsed, weightRatio, maxSpeed: maxSpd, accel, powerFraction, tankCapacity, weightEmpty, condWear };
}

// Finds pf (0.2–1.0) that minimises (fuelCost + repairCost) × time / effectiveCargo.
// opts must include: fuelPrice, repairKitPrice, repairKitsTotal, effectiveCargo, fuelSavingMult, degradationMult
// If no price data is available, returns the fuel-constrained max pf (fastest trip).
function findOptimalFlightPF(distance, ship, cargoWeight, emitter, reactor, speedMult, opts) {
  const { fuelPrice = 0, repairKitPrice = 0, repairKitsTotal = 0, effectiveCargo = 1 } = opts;

  // No cost data — optimize purely for speed (highest pf within fuel limits)
  if (fuelPrice <= 0 && repairKitPrice <= 0) {
    for (let step = 80; step >= 0; step--) {
      const pf = 0.20 + step * 0.01;
      const r  = calcFlight(distance, ship, cargoWeight, emitter, reactor, speedMult, pf, opts);
      if (r.fuelUsed <= r.tankCapacity) return pf;
    }
    return 1.0;
  }

  let bestPF = 1.0, bestScore = Infinity;
  for (let step = 0; step <= 80; step++) {
    const pf = 0.20 + step * 0.01;
    const r  = calcFlight(distance, ship, cargoWeight, emitter, reactor, speedMult, pf, opts);
    const fuelCost   = r.fuelUsed * (fuelPrice > 0 ? fuelPrice : 0);
    const repairCost = repairKitsTotal * r.condWear * (repairKitPrice > 0 ? repairKitPrice : 0);
    const score      = (fuelCost + repairCost) * r.timeHours / Math.max(effectiveCargo, 1);
    if (score < bestScore) { bestScore = score; bestPF = pf; }
  }
  return bestPF;
}

// Finds pf that minimises total trip cost (fuel + repair) / effectiveCargo — ignores travel time.
function findCheapestFlightPF(distance, ship, cargoWeight, emitter, reactor, speedMult, opts) {
  const { fuelPrice = 0, repairKitPrice = 0, repairKitsTotal = 0, effectiveCargo = 1 } = opts;
  if (fuelPrice <= 0 && repairKitPrice <= 0) return 0.20;
  let bestPF = 0.20, bestScore = Infinity;
  for (let step = 0; step <= 80; step++) {
    const pf = 0.20 + step * 0.01;
    const r  = calcFlight(distance, ship, cargoWeight, emitter, reactor, speedMult, pf, opts);
    const fuelCost   = r.fuelUsed * (fuelPrice > 0 ? fuelPrice : 0);
    const repairCost = repairKitsTotal * r.condWear * (repairKitPrice > 0 ? repairKitPrice : 0);
    const score      = (fuelCost + repairCost) / Math.max(effectiveCargo, 1);
    if (score < bestScore) { bestScore = score; bestPF = pf; }
  }
  return bestPF;
}

// ── Per-base needs calculation ────────────────────────────────────────────────

function calcBaseNeeds(base, gamedata) {
  const recipeMap     = new Map(gamedata.recipes.map(r => [r.id, r]));
  const matMap        = new Map(gamedata.materials.map(m => [m.id, m]));
  const warehouseAmts = new Map((base.warehouse?.mats ?? []).map(m => [m.id, m.am]));

  // Production inputs
  const recipeGroups = new Map(); // rId → { recipe, totalMul, cyclesPerDay }

  // Resolve this base's planet for planet-factor calculations
  let basePlanet = null;
  if (base.planetId) {
    outer: for (const sys of gamedata.systems ?? []) {
      for (const p of sys.planets ?? []) {
        if (p?.id === base.planetId) { basePlanet = p; break outer; }
      }
    }
  }

  // Pass 1: active production tasks (currently running)
  // Also record speed data per building type so Pass 2 can inherit bonuses for queued recipes.
  // speedDataByType stores { ratio, refPlanetFactor } where ratio = actualCycleMs / rawCycleMs.
  // Storing the reference planet factor lets us correct for different materials in Pass 2
  // (e.g. a queued copper extract needing different abundance than the active iron extract).
  const speedDataByType = new Map(); // bType → { ratio, refPlanetFactor }
  for (const slot of base.buildingSlots ?? []) {
    if (!slot.building?.task) continue;
    const task   = slot.building.task;
    const recipe = recipeMap.get(task.rId);
    if (!recipe) continue;
    const cycleMs = new Date(task.comD) - new Date(task.startDate);
    if (cycleMs <= 0) continue;
    const cyclesPerDay = (24 * 60 * 60 * 1000) / cycleMs;
    if (!recipeGroups.has(task.rId)) {
      recipeGroups.set(task.rId, { recipe, totalMul: 0, cyclesPerDay });
    }
    recipeGroups.get(task.rId).totalMul += (task.mul ?? 1);
    const bType = recipe.producedIn;
    if (!speedDataByType.has(bType) && recipe.timeMinutes > 0) {
      speedDataByType.set(bType, {
        ratio:           cycleMs / (recipe.timeMinutes * 60 * 1000),
        refPlanetFactor: getPlanetFactor(recipe, basePlanet, gamedata),
      });
    }
  }

  // Pass 2: reconcile infinite production orders against actual building capacity.
  //
  // Buildings between cycles have no active task and are invisible to Pass 1, so Pass 1
  // under-counts capacity for building types that have queued/cycling infinite orders.
  //
  // The game distributes buildings among infinite orders weighted by recipe time, so that
  // each order produces the same number of cycles per day ("equal throughput per order").
  // Proof: weight_i = time_i / Σ(time_j)  →  assignedMul_i × (1/time_i) = constant.

  // Collect all infinite orders from productionOrders, grouped by building type
  const allInfiniteByType = new Map(); // bType → [{ rId, recipe }]
  for (const order of base.productionOrders ?? []) {
    if (order.amt !== 65535) continue;
    const recipe = recipeMap.get(order.rId);
    if (!recipe?.timeMinutes || recipe.timeMinutes <= 0) continue;
    const bType = recipe.producedIn;
    if (!allInfiniteByType.has(bType)) allInfiniteByType.set(bType, []);
    allInfiniteByType.get(bType).push({ rId: order.rId, recipe });
  }

  for (const [bType, orders] of allInfiniteByType) {
    // Always redistribute when there are multiple infinite orders for this building type.
    // The hasQueued guard was too conservative — even when all recipes are in Pass 1,
    // their totalMul reflects a snapshot of whichever buildings happened to be mid-cycle
    // at fetch time, not the steady-state weighted split. Always override with the weighted
    // distribution for building types with >=2 infinite orders.
    if (orders.length < 2) continue;

    // Total capacity = all active tasks of this building type from Pass 1.
    // All buildings of this type are accounted for here — infinite-queue buildings
    // always have an active task (they restart immediately), so Pass 1 captures
    // the full capacity even if some are currently running a different recipe.
    let totalCap = 0;
    for (const group of recipeGroups.values()) {
      if (group.recipe.producedIn === bType) totalCap += group.totalMul;
    }
    if (totalCap === 0) continue;

    // Weight each order by its recipe time so every order gets equal daily throughput.
    // Longer recipes need more buildings to keep up — time_i / Σ(time_j across all orders)
    let totalWeightedTime = 0;
    for (const { recipe } of orders) totalWeightedTime += recipe.timeMinutes;

    // Aggregate count per rId (e.g. 2 concrete orders → concrete appears twice)
    const ordersByRId = new Map(); // rId → { recipe, count }
    for (const { rId, recipe } of orders) {
      if (!ordersByRId.has(rId)) ordersByRId.set(rId, { recipe, count: 0 });
      ordersByRId.get(rId).count++;
    }

    for (const [rId, { recipe, count }] of ordersByRId) {
      const weight      = (recipe.timeMinutes * count) / totalWeightedTime;
      const assignedMul = totalCap * weight;

      // Derive cyclesPerDay for recipes not yet running (new Pass 2 entries only).
      // Active recipes keep their Pass 1 cyclesPerDay (actual timing, fully accurate).
      if (!recipeGroups.has(rId)) {
        // Prefer speed data from an active task of the same building type.
        // Strip out that task's planet factor, apply this recipe's planet factor instead —
        // handles extraction bases where different materials have different abundances.
        const sd = speedDataByType.get(bType);
        let cyclesPerDay;
        if (sd) {
          const researchPerkRatio = sd.ratio * sd.refPlanetFactor; // ratio without planet component
          const planetFactor      = getPlanetFactor(recipe, basePlanet, gamedata);
          const correctedRatio    = researchPerkRatio / planetFactor;
          cyclesPerDay = 86400000 / (recipe.timeMinutes * 60 * 1000 * correctedRatio);
        } else {
          // No active tasks of this building type — use full technology model
          const multiplier = calcSpeedMultiplier(bType, _companyData, gamedata.perks)
                           * getPlanetFactor(recipe, basePlanet, gamedata);
          cyclesPerDay = 86400000 / (recipe.timeMinutes * 60 * 1000 / multiplier);
        }
        recipeGroups.set(rId, { recipe, totalMul: assignedMul, cyclesPerDay });
      } else {
        recipeGroups.get(rId).totalMul = assignedMul;
      }
    }
  }

  // Aggregate inputs by matId across all recipe groups (e.g. Tiridium Alloy used by
  // multiple recipes on the same building type should appear as one combined row).
  const inputsMap = new Map(); // matId → { matId, name, dailyNeed, inStock }
  for (const { recipe, totalMul, cyclesPerDay } of recipeGroups.values()) {
    for (const inp of (recipe.inputs ?? [])) {
      const dailyNeed = inp.am * totalMul * cyclesPerDay;
      if (inputsMap.has(inp.id)) {
        inputsMap.get(inp.id).dailyNeed += dailyNeed;
      } else {
        const inStock = warehouseAmts.get(inp.id) ?? 0;
        inputsMap.set(inp.id, {
          matId: inp.id,
          name:  matMap.get(inp.id)?.name ?? `mat${inp.id}`,
          dailyNeed, inStock,
          days: dailyNeed > 0 ? inStock / dailyNeed : Infinity,
        });
      }
    }
  }
  const inputs = [...inputsMap.values()].map(i => ({ ...i, days: i.dailyNeed > 0 ? i.inStock / i.dailyNeed : Infinity }));

  // Worker consumables — rate is pre-calculated daily consumption
  const consumables = (base.workforce?.consumptionMaterials ?? []).map(c => {
    const inStock = warehouseAmts.get(c.matId) ?? 0;
    const days    = c.rate > 0 ? inStock / c.rate : Infinity;
    return {
      matId: c.matId,
      name:  matMap.get(c.matId)?.name ?? `mat${c.matId}`,
      dailyNeed: c.rate, inStock, days,
    };
  });

  // Outputs per day
  const outputs = [];
  for (const { recipe, totalMul, cyclesPerDay } of recipeGroups.values()) {
    const out = recipe.output;
    if (!out) continue;
    const am = out.am ?? out.a ?? 0;
    if (!am) continue;
    const dailyOutput = am * totalMul * cyclesPerDay;
    outputs.push({
      matId: out.id,
      name:  matMap.get(out.id)?.name ?? `mat${out.id}`,
      dailyOutput,
      inStock: warehouseAmts.get(out.id) ?? 0,
    });
  }

  // Annotate inputs/consumables with self-sufficiency, and outputs with net surplus
  const outputMap = new Map();
  for (const o of outputs) outputMap.set(o.matId, (outputMap.get(o.matId) ?? 0) + o.dailyOutput);
  const inputMap  = new Map();
  for (const item of [...inputs, ...consumables]) {
    inputMap.set(item.matId, (inputMap.get(item.matId) ?? 0) + item.dailyNeed);
  }

  for (const item of [...inputs, ...consumables]) {
    const produced = outputMap.get(item.matId) ?? 0;
    // Use a 1% tolerance to absorb floating-point drift in cyclesPerDay calculations
    if (produced >= item.dailyNeed * 0.99) {
      item.selfProduced = true;
      item.netDailyNeed = 0;
      item.days = Infinity;
    } else if (produced > 0) {
      item.selfProduced = false;
      item.netDailyNeed = item.dailyNeed - produced;
      item.days = item.netDailyNeed > 0 ? item.inStock / item.netDailyNeed : Infinity;
    } else {
      item.selfProduced = false;
      item.netDailyNeed = item.dailyNeed;
    }
  }

  // Annotate outputs with net surplus (gross output minus internal consumption)
  for (const out of outputs) {
    const consumed = inputMap.get(out.matId) ?? 0;
    out.netDailyOutput = Math.max(0, out.dailyOutput - consumed);
  }

  return { inputs, consumables, outputs };
}

// ── Toast notification ────────────────────────────────────────────────────────

function showToast(msg, ok = true) {
  document.getElementById(GT_TOAST_ID)?.remove();
  const t = document.createElement('div');
  t.id = GT_TOAST_ID;
  Object.assign(t.style, {
    position: 'fixed',
    top: `${HEADER_H + 8}px`,
    left: '50%', transform: 'translateX(-50%)',
    background: ok ? '#0d2318' : '#2d0a0a',
    color: ok ? COL_OK : COL_CRIT,
    border: `1px solid ${ok ? COL_OK : COL_CRIT}`,
    borderRadius: '6px', padding: '5px 14px',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px',
    zIndex: '2147483647', whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    transition: 'opacity 0.4s',
    pointerEvents: 'none',
  });
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; }, 2000);
  setTimeout(() => { t.remove(); }, 2400);
}

// ── UI cleanup ────────────────────────────────────────────────────────────────

let _detailBaseId = null;

function removeProductionUI() {
  _headerResizeObs?.disconnect(); _headerResizeObs = null;
  document.getElementById('gt-overscroll-fix')?.remove();
  document.getElementById(GT_HEADER_ID)?.remove();
  document.getElementById(GT_DETAIL_ID)?.remove();
  document.getElementById(GT_SPACER_ID)?.remove();
  document.getElementById(GT_TAB_ID)?.remove();
  document.getElementById(GT_CASH_ID)?.remove();
  document.getElementById(GT_SUMMARY_ID)?.remove();
  document.getElementById(GT_FLIGHT_ID)?.remove();
  document.getElementById(GT_PANEL_WISHLIST_BTN_ID)?.remove();
  _detailBaseId = null;
  _headerCollapsed = false;
  _cashOpen = false;
  _summaryOpen = false;
  _flightOpen = false;
}

// ── Detail panel (drops below header when a chip is clicked) ──────────────────

function buildDetailPanel(base, gamedata) {
  const { inputs, consumables, outputs } = calcBaseNeeds(base, gamedata);

  const panel = document.createElement('div');
  panel.id = GT_DETAIL_ID;
  Object.assign(panel.style, {
    position: 'fixed', top: `${HEADER_H}px`, left: '0',
    minWidth: '300px', maxWidth: '420px',
    maxHeight: `calc(100vh - ${HEADER_H}px - ${getGameBottomNavH()}px)`, overflowY: 'auto',
    background: '#0a0a18', border: '1px solid #2a2a4a',
    borderTop: 'none', borderRadius: '0 8px 8px 8px',
    padding: '8px 10px 10px',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#b0b0cc',
    zIndex: '2147483645', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
  });

  // Base name header
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0 0 7px;border-bottom:1px solid #1a1a2e;margin-bottom:4px;';
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'color:#e0e0f0;font-size:13px;font-weight:600;';
  nameEl.textContent = base.name;

  // Cost toggle button
  const costToggle = document.createElement('button');
  const updateCostToggle = () => {
    costToggle.textContent = _settings.showCosts ? '\u2248 Hide costs' : '\u2248 Show costs';
    costToggle.style.color = _settings.showCosts ? COL_OK : '#6b6b8a';
  };
  costToggle.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;padding:0;font-family:inherit;';
  updateCostToggle();
  costToggle.addEventListener('click', async () => {
    _settings.showCosts = !_settings.showCosts;
    saveSettings();
    updateCostToggle();
    // Reload prices then rebuild content
    if (_settings.showCosts) {
      costToggle.textContent = 'Loading\u2026';
      costToggle.disabled = true;
      await fetchMatPrices();
      costToggle.disabled = false;
      updateCostToggle();
    }
    rebuildContent();
  });

  nameRow.appendChild(nameEl);
  nameRow.appendChild(costToggle);
  panel.appendChild(nameRow);

  // ── Warehouse fill bar (async) ────────────────────────────────────────────
  const whBarArea = document.createElement('div');
  whBarArea.style.cssText = 'padding:4px 0 6px;border-bottom:1px solid #1a1a2e;margin-bottom:4px;';
  panel.appendChild(whBarArea);

  const _matWeightMap = new Map((gamedata.materials ?? []).map(m => [m.id, m.weight ?? 0]));
  const _whCurrentWeight = (base.warehouse?.mats ?? []).reduce(
    (s, m) => s + (m.am ?? 0) * (_matWeightMap.get(Number(m.id)) ?? 0), 0);

  function _renderWhBar(cap) {
    whBarArea.innerHTML = '';
    if (!cap) { whBarArea.style.display = 'none'; return; }
    whBarArea.style.display = '';
    const fillPct = Math.min(1, _whCurrentWeight / cap);
    const fillCol = fillPct >= 0.95 ? '#ef4444' : fillPct >= 0.80 ? '#f59e0b' : '#22c55e';

    const barRow = document.createElement('div');
    barRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'flex:1;height:3px;background:#1a1a30;border-radius:2px;overflow:hidden;';
    const barFill = document.createElement('div');
    barFill.style.cssText = `height:100%;width:${(fillPct * 100).toFixed(1)}%;background:${fillCol};border-radius:2px;`;
    barWrap.appendChild(barFill);
    const wtLabel = document.createElement('span');
    wtLabel.style.cssText = 'color:#6b6b8a;font-size:10px;white-space:nowrap;flex-shrink:0;';
    wtLabel.textContent = `${Math.round(_whCurrentWeight).toLocaleString()}t / ${Math.round(cap).toLocaleString()}t`;
    barRow.appendChild(barWrap);
    barRow.appendChild(wtLabel);
    whBarArea.appendChild(barRow);

    const netWeightGain = outputs.reduce((s, o) => s + (o.netDailyOutput ?? o.dailyOutput) * (_matWeightMap.get(Number(o.matId)) ?? 0), 0)
      - [...inputs, ...consumables].reduce((s, i) => s + i.dailyNeed * (_matWeightMap.get(Number(i.matId)) ?? 0), 0);
    if (netWeightGain > 0) {
      const rem = cap - _whCurrentWeight;
      if (rem > 0) {
        const fullLbl = document.createElement('span');
        fullLbl.style.cssText = 'display:block;color:#6b6b8a;font-size:10px;margin-top:2px;';
        fullLbl.textContent = `Full in ${fmtDays(rem / netWeightGain)}`;
        whBarArea.appendChild(fullLbl);
      }
    }
  }

  const _whId = base.warehouse?.id ?? base.warehouseId;
  if (_whId) {
    requestGTLocalAPI('getWarehouse', { warehouseId: _whId }).then(wh => _renderWhBar(wh?.cap ?? 0));
  } else {
    whBarArea.style.display = 'none';
  }

  // Content area — rebuilt when cost toggle changes
  const contentArea = document.createElement('div');
  panel.appendChild(contentArea);

  const td = _settings.targetDays;

  function rebuildContent() {
    contentArea.innerHTML = '';
    const showCosts = _settings.showCosts; // column always visible when toggle is on; shows — if prices missing
    let totalDailyInputCost = 0;
    let totalDailyOutputValue = 0;

    const renderSection = (items, heading, cartLabel) => {
      if (!items.length) return;

      const hRow = document.createElement('div');
      hRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:6px 0 3px;';
      const h = mkLabel(heading);
      const sectionCart = document.createElement('button');
      sectionCart.innerHTML = '&#128722;';
      sectionCart.title = `Wishlist: ${heading}`;
      sectionCart.style.cssText = `background:none;border:none;cursor:pointer;font-size:11px;padding:0;line-height:1;color:#6b6b8a;flex-shrink:0;display:${_settings.showWishlist ? '' : 'none'};`;
      sectionCart.addEventListener('mouseenter', () => { sectionCart.style.color = COL_OK; });
      sectionCart.addEventListener('mouseleave', () => { if (!sectionCart.disabled) sectionCart.style.color = '#6b6b8a'; });
      sectionCart.addEventListener('click', () => handleSectionWishlist(base, items, cartLabel, sectionCart));
      hRow.appendChild(h);
      hRow.appendChild(sectionCart);
      contentArea.appendChild(hRow);

      let sectionRestockCost = 0;
      let sectionDailyCost   = 0;
      const sectionItems = []; // for section total tooltip
      for (const r of items) {
        const isSelf    = r.selfProduced === true;
        const isPartial = !isSelf && r.netDailyNeed != null && r.netDailyNeed < r.dailyNeed;
        const col       = isSelf ? '#3a3a5a' : daysColour(r.days);
        const daysStr   = fmtDays(r.days);
        const netNeed   = r.netDailyNeed ?? r.dailyNeed;
        const deficit   = isSelf ? 0 : Math.max(0, Math.ceil(netNeed * td - r.inStock));
        const unitPrice = effectivePrice(r.matId);
        const lineCost  = isSelf ? 0 : unitPrice * deficit;
        const lineDailyCost = isSelf ? 0 : unitPrice * netNeed;
        sectionRestockCost += lineCost;
        sectionDailyCost   += lineDailyCost;
        totalDailyInputCost += lineDailyCost;
        sectionItems.push({ r, isSelf, isPartial, netNeed, deficit, col, daysStr, unitPrice });

        // cols: name | /d | stock | needed | time-left
        const row = document.createElement('div');
        row.style.cssText = `display:grid;grid-template-columns:1fr auto auto auto auto;gap:4px;align-items:center;padding:3px 0;border-bottom:1px solid #12122a;cursor:default;${isSelf ? 'opacity:0.55;' : ''}`;

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `color:${isSelf ? '#4a4a6a' : '#c0c0da'};display:flex;align-items:center;gap:4px;min-width:0;`;
        const icon0 = makeIcon(r.name);
        if (icon0) nameSpan.appendChild(icon0);
        const nameText0 = document.createElement('span');
        nameText0.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameText0.textContent = (isSelf || isPartial ? '\u267b ' : '') + r.name;
        nameSpan.appendChild(nameText0);

        const needSpan = document.createElement('span');
        needSpan.style.cssText = 'color:#6b6b8a;font-size:10px;white-space:nowrap;text-align:right;';
        needSpan.textContent = isSelf ? '\u2014' : Math.round(isPartial ? netNeed : r.dailyNeed).toLocaleString() + '/d';

        const deficitSpan = document.createElement('span');
        deficitSpan.style.cssText = 'color:#6b6b8a;font-size:10px;white-space:nowrap;text-align:right;';
        deficitSpan.textContent = isSelf ? 'on-planet' : (deficit > 0 ? deficit.toLocaleString() : '0');

        const stockSpan = document.createElement('span');
        stockSpan.style.cssText = `color:${col};font-size:10px;font-weight:600;white-space:nowrap;text-align:right;`;
        stockSpan.textContent = isSelf ? '' : Math.round(r.inStock).toLocaleString();

        const daysSpan = document.createElement('span');
        daysSpan.style.cssText = `color:${col};font-size:11px;font-weight:600;text-align:right;`;
        daysSpan.textContent = isSelf ? '' : daysStr;

        row.appendChild(nameSpan);
        row.appendChild(needSpan);
        row.appendChild(deficitSpan);
        row.appendChild(stockSpan);
        row.appendChild(daysSpan);

        // Row hover tooltip: label columns
        let rowTip = null;
        row.addEventListener('mouseenter', () => {
          rowTip = document.createElement('div');
          rowTip.style.cssText = 'position:fixed;z-index:2147483647;background:#0d0d20;border:1px solid #2a2a4a;border-radius:5px;padding:6px 9px;font-size:11px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.6);';
          if (isSelf) {
            const s = document.createElement('span');
            s.style.color = '#4a4a6a';
            s.textContent = 'Produced on this base — no import needed';
            rowTip.appendChild(s);
          } else {
            const rows2 = [
              ['/day needed',   Math.round(isPartial ? netNeed : r.dailyNeed).toLocaleString(), '#6b6b8a'],
              ['Amount needed', deficit > 0 ? deficit.toLocaleString() : '0',                   '#6b6b8a'],
              ['Current stock', Math.round(r.inStock).toLocaleString(),                          col],
              ['Time left',     daysStr,                                                          col],
            ];
            if (isPartial) rows2.splice(0, 0, ['Gross /day', Math.round(r.dailyNeed).toLocaleString(), '#4a4a6a']);
            for (const [lbl, val, vc] of rows2) {
              const line = document.createElement('div');
              line.style.cssText = 'display:flex;justify-content:space-between;gap:16px;padding:1px 0;';
              const l = document.createElement('span'); l.style.color = '#6b6b8a'; l.textContent = lbl;
              const v = document.createElement('span'); v.style.cssText = `color:${vc};font-weight:600;`; v.textContent = val;
              line.appendChild(l); line.appendChild(v);
              rowTip.appendChild(line);
            }
          }
          document.body.appendChild(rowTip);
        });
        row.addEventListener('mousemove', (e) => {
          if (!rowTip) return;
          const x = Math.min(e.clientX + 12, window.innerWidth  - rowTip.offsetWidth  - 8);
          const y = Math.min(e.clientY + 12, window.innerHeight - rowTip.offsetHeight - 8);
          rowTip.style.left = x + 'px'; rowTip.style.top = y + 'px';
        });
        row.addEventListener('mouseleave', () => { rowTip?.remove(); rowTip = null; });

        contentArea.appendChild(row);
      }

      if (showCosts && (sectionRestockCost > 0 || sectionDailyCost > 0)) {
        const totRow = document.createElement('div');
        totRow.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;padding:3px 0 1px;border-top:1px solid #1a1a2e;margin-top:2px;cursor:default;';
        const totLabel = document.createElement('span');
        totLabel.style.cssText = 'color:#6b6b8a;font-size:10px;';
        totLabel.textContent = 'Section total';
        const restockVal = document.createElement('span');
        restockVal.style.cssText = 'color:#9090b0;font-size:10px;text-align:right;white-space:nowrap;';
        restockVal.textContent = sectionRestockCost > 0 ? `$${Math.round(sectionRestockCost).toLocaleString()}` : '\u2014';
        const dailyVal = document.createElement('span');
        dailyVal.style.cssText = 'color:#6b6b8a;font-size:10px;text-align:right;white-space:nowrap;';
        dailyVal.textContent = sectionDailyCost > 0 ? `$${Math.round(sectionDailyCost).toLocaleString()}/d` : '\u2014';
        totRow.append(totLabel, restockVal, dailyVal);

        // Hover tooltip: restock cost breakdown — [icon] Material xAmount @ $Price
        attachTooltip(totRow, tip => {
          const restockLines = sectionItems.filter(si => !si.isSelf && si.deficit > 0 && si.unitPrice > 0);
          if (!restockLines.length) return false;
          tip.appendChild(mkTipTitle('Restock cost'));
          for (const { r, deficit, unitPrice } of restockLines) {
            tip.appendChild(mkIconLine(r.name, `${r.name} x${deficit.toLocaleString()}`, `@ ${fmtCr(unitPrice)} ($${Math.round(unitPrice * deficit).toLocaleString()})`));
          }
          if (restockLines.length > 1) {
            const sep = document.createElement('div');
            sep.style.cssText = 'border-top:1px solid #1a1a30;margin:5px 0 3px;';
            tip.appendChild(sep);
            const tot = document.createElement('div');
            tot.style.cssText = 'display:flex;justify-content:space-between;gap:12px;';
            const tl = document.createElement('span'); tl.style.color = '#6b6b8a'; tl.textContent = 'Total';
            const tv = document.createElement('span'); tv.style.cssText = 'color:#b0b0cc;font-weight:600;'; tv.textContent = `$${Math.round(sectionRestockCost).toLocaleString()}`;
            tot.appendChild(tl); tot.appendChild(tv);
            tip.appendChild(tot);
          }
        });

        contentArea.appendChild(totRow);
        totalRestockCost += sectionRestockCost;
      }
    };

    let totalRestockCost = 0;
    renderSection(inputs,      'Production Inputs',   'inputs');
    renderSection(consumables, 'Worker Consumables', 'consumables');

    // Combined inputs total
    if (showCosts && (totalRestockCost > 0 || totalDailyInputCost > 0)) {
      const combinedRow = document.createElement('div');
      combinedRow.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;padding:4px 0 2px;border-top:2px solid #2a2a4a;margin-top:3px;';
      const comLabel = document.createElement('span');
      comLabel.style.cssText = 'color:#c0c0da;font-size:10px;font-weight:600;';
      comLabel.textContent = 'Total inputs';
      const comRestock = document.createElement('span');
      comRestock.style.cssText = 'color:#b0b0cc;font-size:10px;font-weight:600;text-align:right;white-space:nowrap;';
      comRestock.title = 'Total restock cost';
      comRestock.textContent = totalRestockCost > 0 ? `$${Math.round(totalRestockCost).toLocaleString()}` : '\u2014';
      const comDaily = document.createElement('span');
      comDaily.style.cssText = 'color:#9090b0;font-size:10px;font-weight:600;text-align:right;white-space:nowrap;';
      comDaily.title = 'Total daily cost';
      comDaily.textContent = totalDailyInputCost > 0 ? `$${Math.round(totalDailyInputCost).toLocaleString()}/d` : '\u2014';
      combinedRow.append(comLabel, comRestock, comDaily);
      contentArea.appendChild(combinedRow);
    }

    // Outputs section
    const outputItems = []; // for income/net tooltips
    if (outputs.length) {
      const oh = document.createElement('div');
      oh.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:6px 0 3px;';
      const ohLabel = mkLabel('Net Outputs / day');
      oh.appendChild(ohLabel);
      contentArea.appendChild(oh);

      for (const r of outputs) {
        const netOutput  = r.netDailyOutput ?? r.dailyOutput;
        const unitPrice  = effectivePrice(r.matId);
        const dailyValue = unitPrice * netOutput;
        totalDailyOutputValue += dailyValue;
        outputItems.push({ r, unitPrice, dailyValue });

        const cols = showCosts ? '1fr auto auto auto' : '1fr auto auto';
        const row = document.createElement('div');
        row.style.cssText = `display:grid;grid-template-columns:${cols};gap:5px;align-items:center;padding:3px 0;border-bottom:1px solid #12122a;cursor:default;`;

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color:#c0c0da;display:flex;align-items:center;gap:4px;min-width:0;';
        const icon1 = makeIcon(r.name);
        if (icon1) nameSpan.appendChild(icon1);
        const nameText1 = document.createElement('span');
        nameText1.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameText1.textContent = r.name;
        nameSpan.appendChild(nameText1);

        const qtySpan = document.createElement('span');
        qtySpan.style.cssText = 'color:#9090b0;font-size:10px;white-space:nowrap;text-align:right;';
        qtySpan.textContent = Math.round(netOutput).toLocaleString() + '/d';

        const stockSpan = document.createElement('span');
        stockSpan.style.cssText = 'color:#7a7a9a;font-size:10px;white-space:nowrap;text-align:right;';
        stockSpan.textContent = Math.round(r.inStock).toLocaleString();

        row.appendChild(nameSpan);
        row.appendChild(qtySpan);
        row.appendChild(stockSpan);

        if (showCosts) {
          const valSpan = document.createElement('span');
          valSpan.style.cssText = `color:${COL_OK};font-size:10px;white-space:nowrap;text-align:right;`;
          valSpan.textContent = dailyValue > 0 ? fmtCr(dailyValue) + '/d' : '\u2014';
          row.appendChild(valSpan);
        }

        // Row hover tooltip — show when costs visible OR when output is netted down
        const isNetted = r.netDailyOutput != null && r.netDailyOutput < r.dailyOutput;
        if (showCosts && dailyValue > 0 || isNetted) {
          let rowTip = null;
          row.addEventListener('mouseenter', () => {
            rowTip = document.createElement('div');
            rowTip.style.cssText = 'position:fixed;z-index:2147483647;background:#0d0d20;border:1px solid #2a2a4a;border-radius:6px;padding:8px 10px;font-size:11px;color:#b0b0cc;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.6);';
            const line = document.createElement('div');
            line.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
            const left = document.createElement('div');
            left.style.cssText = 'display:flex;align-items:center;gap:5px;';
            const ic = makeIcon(r.name, 14);
            if (ic) left.appendChild(ic);
            const lbl = document.createElement('span');
            lbl.style.color = '#c0c0da';
            lbl.textContent = `${r.name} x${Math.round(netOutput).toLocaleString()}/d`;
            left.appendChild(lbl);
            if (showCosts && dailyValue > 0) {
              const val = document.createElement('span');
              val.style.color = '#9090b0';
              val.textContent = `@ ${fmtCr(unitPrice)} (${fmtCr(dailyValue)}/d)`;
              line.appendChild(left); line.appendChild(val);
            } else {
              line.appendChild(left);
            }
            rowTip.appendChild(line);
            if (isNetted) {
              const grossLine = document.createElement('div');
              grossLine.style.cssText = 'display:flex;justify-content:space-between;gap:16px;padding:2px 0 0;';
              const gl = document.createElement('span'); gl.style.color = '#4a4a6a'; gl.textContent = 'Gross /day';
              const gv = document.createElement('span'); gv.style.cssText = 'color:#4a4a6a;font-weight:600;'; gv.textContent = Math.round(r.dailyOutput).toLocaleString();
              grossLine.appendChild(gl); grossLine.appendChild(gv);
              rowTip.appendChild(grossLine);
            }
            document.body.appendChild(rowTip);
          });
          row.addEventListener('mousemove', (e) => {
            if (!rowTip) return;
            const x = Math.min(e.clientX + 12, window.innerWidth  - rowTip.offsetWidth  - 8);
            const y = Math.min(e.clientY + 12, window.innerHeight - rowTip.offsetHeight - 8);
            rowTip.style.left = x + 'px'; rowTip.style.top = y + 'px';
          });
          row.addEventListener('mouseleave', () => { rowTip?.remove(); rowTip = null; });
        }

        contentArea.appendChild(row);
      }

      if (showCosts && totalDailyOutputValue > 0) {
        const totRow = document.createElement('div');
        totRow.style.cssText = 'display:flex;justify-content:flex-end;padding:3px 0 1px;color:#22c55e;font-size:10px;cursor:default;';
        totRow.textContent = 'Income: ' + fmtCr(totalDailyOutputValue) + '/d';

        // Income total tooltip: breakdown per output
        if (outputItems.length > 1) {
          attachTooltip(totRow, tip => {
            tip.appendChild(mkTipTitle('Daily income'));
            for (const { r: or, unitPrice: up, dailyValue: dv } of outputItems) {
              if (!dv) continue;
              tip.appendChild(mkIconLine(or.name, `${or.name} x${Math.round(or.dailyOutput).toLocaleString()}/d`, `@ ${fmtCr(up)} (${fmtCr(dv)}/d)`));
            }
          });
        }

        contentArea.appendChild(totRow);
      }
    }

    // Net profit row (only when showCosts is on and we have some data)
    if (showCosts && (totalDailyOutputValue > 0 || totalDailyInputCost > 0)) {
      const netProfit = totalDailyOutputValue - totalDailyInputCost;
      const netCol = netProfit >= 0 ? COL_OK : COL_CRIT;
      const netRow = document.createElement('div');
      netRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0 2px;border-top:2px solid #1e1e3a;margin-top:4px;cursor:default;';
      const netLabel = mkLabel('Net profit');
      const netVal = document.createElement('span');
      netVal.style.cssText = `color:${netCol};font-size:12px;font-weight:700;`;
      netVal.textContent = (netProfit >= 0 ? '+' : '\u2212') + fmtCr(Math.abs(netProfit)) + '/d';
      netRow.appendChild(netLabel);
      netRow.appendChild(netVal);

      // Net profit tooltip: income vs costs breakdown
      let netTip = null;
      netRow.addEventListener('mouseenter', () => {
        netTip = document.createElement('div');
        netTip.style.cssText = 'position:fixed;z-index:2147483647;background:#0d0d20;border:1px solid #2a2a4a;border-radius:6px;padding:8px 10px;font-size:11px;color:#b0b0cc;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.6);';
        const mkLine = (lbl, val, vc) => {
          const d = document.createElement('div');
          d.style.cssText = 'display:flex;justify-content:space-between;gap:20px;padding:2px 0;';
          const l = document.createElement('span'); l.style.color = '#6b6b8a'; l.textContent = lbl;
          const v = document.createElement('span'); v.style.cssText = `color:${vc};font-weight:600;`; v.textContent = val;
          d.appendChild(l); d.appendChild(v);
          return d;
        };
        if (totalDailyOutputValue > 0) netTip.appendChild(mkLine('Income', '+' + fmtCr(totalDailyOutputValue) + '/d', COL_OK));
        if (totalDailyInputCost  > 0) netTip.appendChild(mkLine('Input costs', '\u2212' + fmtCr(totalDailyInputCost) + '/d', COL_CRIT));
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px solid #1a1a30;margin:4px 0 2px;';
        netTip.appendChild(sep);
        netTip.appendChild(mkLine('Net', (netProfit >= 0 ? '+' : '\u2212') + fmtCr(Math.abs(netProfit)) + '/d', netCol));
        document.body.appendChild(netTip);
      });
      netRow.addEventListener('mousemove', (e) => {
        if (!netTip) return;
        const x = Math.min(e.clientX + 12, window.innerWidth  - netTip.offsetWidth  - 8);
        const y = Math.min(e.clientY + 12, window.innerHeight - netTip.offsetHeight - 8);
        netTip.style.left = x + 'px'; netTip.style.top = y + 'px';
      });
      netRow.addEventListener('mouseleave', () => { netTip?.remove(); netTip = null; });

      contentArea.appendChild(netRow);
    }

    const allItems = [
      ...(_settings.includeInputs ? inputs : []),
      ...(_settings.includeConsumables ? consumables : []),
      ...outputs,
    ];
    if (!allItems.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#6b6b8a;font-style:italic;padding:6px 0;';
      empty.textContent = 'No active production detected.';
      contentArea.appendChild(empty);
    }
  }

  // Initial build — pre-load prices if showCosts already on
  if (_settings.showCosts && !_priceMap) {
    fetchMatPrices().then(() => rebuildContent());
  }
  rebuildContent();

  return panel;
}

function toggleBaseDetail(base, gamedata) {
  const same = _detailBaseId === String(base.id);
  closeAllPanels();
  if (!same) {
    _detailBaseId = String(base.id);
    document.body.appendChild(buildDetailPanel(base, gamedata));
  }
}

// ── Wishlist creation ─────────────────────────────────────────────────────────

// Build mat list from items array using current settings
function buildMatList(items) {
  const td = _settings.targetDays;
  return items
    .map(r => {
      const need = r.netDailyNeed ?? r.dailyNeed;
      return {
        id: r.matId,
        am: _settings.includeStock
          ? Math.max(0, Math.ceil(need * td - r.inStock))
          : Math.ceil(need * td),
      };
    })
    .filter(m => m.am > 0);
}

// Core wishlist API call — animates btn, shows toast, returns true on success
async function submitWishlist(title, mats, btn) {
  const apiKey = await getExtApiKey();
  if (!apiKey) {
    showToast('Extended API key needed \u2014 set in Settings', false);
    return;
  }
  if (!mats.length) {
    showToast(`Already stocked \u2265${_settings.targetDays}d`);
    return;
  }
  if (btn) { btn.disabled = true; btn.style.color = COL_LOW; }
  try {
    const resp = await fetch(
      `${GT_API}/public/wishlist/create?apikey=${encodeURIComponent(apiKey)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, mats }) }
    );
    if (resp.status === 403) { showToast('Extended API Key required for Wishlisting', false); return; }
    if (!resp.ok) throw new Error(`${resp.status}`);
    showToast(`\u2713 ${title}`);
    if (btn) { btn.style.color = COL_OK; setTimeout(() => { btn.style.color = ''; }, 3000); }
  } catch (err) {
    showToast(`Wishlist failed: ${err.message}`, false);
    if (btn) { btn.style.color = COL_CRIT; setTimeout(() => { btn.style.color = ''; }, 3000); }
  } finally {
    if (btn) { btn.disabled = false; btn.title = 'Create wishlist'; }
  }
}

// Full-base wishlist (chip cart button)
async function handleCreateWishlist(base, gamedata, cartBtn) {
  const { inputs, consumables } = calcBaseNeeds(base, gamedata);
  const eligible = [
    ...(_settings.includeInputs      ? inputs      : []),
    ...(_settings.includeConsumables ? consumables : []),
  ];
  const td = _settings.targetDays;
  await submitWishlist(`${base.name} \u2014 ${td}d restock`, buildMatList(eligible), cartBtn);
}

// Section-specific wishlist (detail panel cart buttons)
async function handleSectionWishlist(base, items, label, btn) {
  const td = _settings.targetDays;
  await submitWishlist(`${base.name} \u2014 ${label} ${td}d`, buildMatList(items), btn);
}

// Wishlist All — one wishlist per visible base
// opts: { bases, includeInputs, includeConsumables, includeStock, addToPanel, panelOnly }
async function handleWishlistAll(btn, opts = {}) {
  const panelOnly  = opts.panelOnly  ?? false;
  const addToPanel = opts.addToPanel ?? false;

  if (!panelOnly) {
    const apiKey = await getExtApiKey();
    if (!apiKey) { showToast('Extended API key needed \u2014 set in Settings', false); return; }
  }
  if (!_loadedHeaderBases || !_loadedHeaderGamedata) return;

  const bases           = opts.bases             ?? sortBases(_loadedHeaderBases).filter(b => !_settings.hiddenBases.includes(String(b.id)));
  const inclInputs      = opts.includeInputs      ?? _settings.includeInputs;
  const inclConsumables = opts.includeConsumables ?? _settings.includeConsumables;
  const inclStock       = opts.includeStock       ?? _settings.includeStock;
  const td              = opts.targetDays         ?? _settings.targetDays;

  if (!bases.length) return;

  btn.disabled = true;
  const origText = btn.textContent;
  btn.style.color = COL_LOW;

  let ok = 0, fail = 0, skip = 0;
  let addedToPanel = false;
  for (const base of bases) {
    const { inputs, consumables } = calcBaseNeeds(base, _loadedHeaderGamedata);
    const eligible = [
      ...(inclInputs      ? inputs      : []),
      ...(inclConsumables ? consumables : []),
    ];
    const mats = eligible
      .map(r => ({
        id: r.matId,
        am: inclStock
          ? Math.max(0, Math.ceil(r.dailyNeed * td - r.inStock))
          : Math.ceil(r.dailyNeed * td),
      }))
      .filter(m => m.am > 0);
    if (!mats.length) { skip++; continue; }

    // Add to extension panel wishlist
    if (panelOnly || addToPanel) {
      await addToPanelWishlist(base, mats);
      addedToPanel = true;
    }

    // Add to game wishlist (unless panel only)
    if (!panelOnly) {
      const apiKey = await getExtApiKey();
      try {
        const resp = await fetch(
          `${GT_API}/public/wishlist/create?apikey=${encodeURIComponent(apiKey)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: `${base.name} \u2014 ${td}d restock`, mats }) }
        );
        if (resp.status === 403) { showToast('Extended API Key required for Wishlisting', false); break; }
        if (!resp.ok) throw new Error();
        ok++;
      } catch { fail++; }
    } else {
      ok++;
    }
  }

  btn.disabled = false;
  btn.style.color = fail ? COL_CRIT : COL_OK;
  btn.textContent = origText;
  setTimeout(() => { btn.style.color = ''; }, 3000);

  if (addedToPanel) {
    // Refresh or open panel
    const existing = document.getElementById(GT_PANEL_WISHLIST_ID);
    if (existing) {
      loadPanelWishlist().then(data => _renderPanelWishlistContent(existing, data));
    } else {
      openPanelWishlist();
    }
  }

  if (panelOnly) {
    if (skip) showToast(`\u2713 ${ok} bases added to panel (${skip} already stocked)`);
    else      showToast(`\u2713 ${ok} bases added to panel wishlist`);
  } else if (fail) showToast(`${ok} wishlists created, ${fail} failed`, false);
  else if (skip)   showToast(`\u2713 ${ok} wishlists created (${skip} bases already stocked)`);
  else             showToast(`\u2713 ${ok} wishlists created`);
}

// Wishlist-all panel
// onConfirm receives opts: { bases, includeInputs, includeConsumables, includeStock }
function showWishlistAllModal(onConfirm) {
  if (!_loadedHeaderBases || !_loadedHeaderGamedata) return;
  const existing = document.getElementById(GT_WISHLIST_ALL_ID);
  if (existing) { existing.remove(); _wishlistAllOpen = false; return; }

  const allBases = sortBases(_loadedHeaderBases);
  if (!allBases.length) return;

  closeAllPanels();

  // Local state — does not affect _settings
  const localState = {
    targetDays:         _settings.targetDays,
    includeInputs:      _settings.includeInputs,
    includeConsumables: _settings.includeConsumables,
    includeStock:       _settings.includeStock,
    addToPanel:         false,
    panelOnly:          false,
  };
  const localBasesOn = new Set(allBases.map(b => String(b.id)));

  const modal = mkPanelBase(GT_WISHLIST_ALL_ID, true);
  modal.style.width = '300px';
  modal.appendChild(mkPanelTitle('Wishlist All Bases'));
  _wishlistAllOpen = true;

  // ── Bases section ──────────────────────────────────────────────────────────
  const basesLabel = mkLabel('', 'margin-bottom:6px;');
  modal.appendChild(basesLabel);

  const updateBasesLabel = () => {
    basesLabel.textContent = `Bases (${localBasesOn.size} of ${allBases.length})`;
  };
  updateBasesLabel();

  // Select all / Deselect all
  const selAllRow = document.createElement('div');
  selAllRow.style.cssText = 'display:flex;gap:8px;margin-bottom:4px;';
  const _mkSelBtn = (label) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;color:#6b6b8a;padding:0;font-family:inherit;text-decoration:underline;';
    btn.addEventListener('mouseenter', () => { btn.style.color = '#9090b0'; });
    btn.addEventListener('mouseleave', () => { btn.style.color = '#6b6b8a'; });
    return btn;
  };
  const selAllBtn   = _mkSelBtn('Select all');
  const deselAllBtn = _mkSelBtn('Deselect all');
  selAllRow.append(selAllBtn, deselAllBtn);
  modal.appendChild(selAllRow);

  const basesList = document.createElement('div');
  basesList.style.cssText = 'background:#0a0a18;border:1px solid #1a1a30;border-radius:6px;padding:8px 10px;margin-bottom:14px;max-height:140px;overflow-y:auto;';

  const _renderBaseRows = () => {
    basesList.innerHTML = '';
    allBases.forEach(b => {
      const bid = String(b.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:2px 0;font-size:12px;';
      const { col } = baseStatusColour(b, _loadedHeaderGamedata);
      const dot = document.createElement('span');
      dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0;display:inline-block;`;
      const name = document.createElement('span');
      name.style.cssText = 'flex:1;color:#c0c0da;';
      name.textContent = b.name;
      const tog = buildMiniToggle(localBasesOn.has(bid), val => {
        if (val) localBasesOn.add(bid); else localBasesOn.delete(bid);
        updateBasesLabel();
      });
      row.append(dot, name, tog);
      basesList.appendChild(row);
    });
  };
  _renderBaseRows();

  selAllBtn.addEventListener('click', () => {
    allBases.forEach(b => localBasesOn.add(String(b.id)));
    _renderBaseRows(); updateBasesLabel();
  });
  deselAllBtn.addEventListener('click', () => {
    localBasesOn.clear();
    _renderBaseRows(); updateBasesLabel();
  });

  modal.appendChild(basesList);

  // ── Settings section ───────────────────────────────────────────────────────
  const sumLabel = mkLabel('Wishlist settings', 'margin-bottom:6px;');
  modal.appendChild(sumLabel);

  const settingsBox = document.createElement('div');
  settingsBox.style.cssText = 'background:#0a0a18;border:1px solid #1a1a30;border-radius:6px;padding:6px 10px;margin-bottom:10px;';

  // Stock period — editable for this wishlist run only
  const stockPeriodRow = document.createElement('div');
  stockPeriodRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid #12122a;';
  const spLabel = document.createElement('span'); spLabel.style.color = '#6b6b8a'; spLabel.textContent = 'Stock period';
  const spInput = document.createElement('input');
  spInput.type = 'number'; spInput.min = '0.1'; spInput.max = '365'; spInput.step = '0.1';
  spInput.value = localState.targetDays.toFixed(1);
  spInput.style.cssText = 'width:52px;background:#1a1a30;border:1px solid #2a2a4a;border-radius:4px;color:#c0c0da;font-size:11px;padding:2px 4px;text-align:right;font-family:inherit;';
  spInput.addEventListener('input', () => {
    const v = parseFloat(spInput.value);
    if (v > 0) localState.targetDays = v;
  });
  const spSuffix = document.createElement('span'); spSuffix.style.cssText = 'color:#6b6b8a;margin-left:3px;'; spSuffix.textContent = 'd';
  const spRight = document.createElement('div'); spRight.style.cssText = 'display:flex;align-items:center;gap:0;';
  spRight.append(spInput, spSuffix);
  stockPeriodRow.append(spLabel, spRight);
  settingsBox.appendChild(stockPeriodRow);

  const toggleRows = [
    { label: 'Subtract current stock', key: 'includeStock' },
    { label: 'Production inputs',      key: 'includeInputs' },
    { label: 'Worker consumables',     key: 'includeConsumables' },
  ];
  toggleRows.forEach(({ label, key }) => {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid #12122a;`;
    const lbl = document.createElement('span'); lbl.style.color = '#6b6b8a'; lbl.textContent = label;
    const tog = buildMiniToggle(localState[key], val => { localState[key] = val; });
    row.append(lbl, tog);
    settingsBox.appendChild(row);
  });

  // Panel wishlist toggles (mutually exclusive)
  let addToPanelTog, panelOnlyTog;
  const panelRows = [
    { label: 'Add to panel',  key: 'addToPanel' },
    { label: 'Panel only',    key: 'panelOnly'  },
  ];
  panelRows.forEach(({ label, key }, idx) => {
    const row = document.createElement('div');
    const isLast = idx === panelRows.length - 1;
    row.style.cssText = `display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;${isLast ? '' : 'border-bottom:1px solid #12122a;'}`;
    const lbl = document.createElement('span'); lbl.style.color = '#9090b0'; lbl.textContent = label;
    const tog = buildMiniToggle(false, val => {
      localState[key] = val;
      // Mutually exclusive: turning one on turns the other off
      if (val) {
        const otherKey = key === 'addToPanel' ? 'panelOnly' : 'addToPanel';
        const otherTog = key === 'addToPanel' ? panelOnlyTog : addToPanelTog;
        localState[otherKey] = false;
        otherTog?._setOff?.();
      }
    });
    if (key === 'addToPanel') addToPanelTog = tog; else panelOnlyTog = tog;
    row.append(lbl, tog);
    settingsBox.appendChild(row);
  });

  modal.appendChild(settingsBox);

  // ── Buttons ────────────────────────────────────────────────────────────────
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:none;border:1px solid #2a2a4a;border-radius:5px;color:#6b6b8a;font-size:12px;padding:6px 14px;cursor:pointer;font-family:inherit;';
  cancelBtn.addEventListener('click', () => { modal.remove(); _wishlistAllOpen = false; });

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Create Wishlists \u2192';
  confirmBtn.style.cssText = 'background:#166534;border:none;border-radius:5px;color:#22c55e;font-size:12px;padding:6px 14px;cursor:pointer;font-family:inherit;font-weight:600;';
  confirmBtn.addEventListener('click', () => {
    modal.remove();
    _wishlistAllOpen = false;
    onConfirm({
      bases:              allBases.filter(b => localBasesOn.has(String(b.id))),
      targetDays:         localState.targetDays,
      includeInputs:      localState.includeInputs,
      includeConsumables: localState.includeConsumables,
      includeStock:       localState.includeStock,
      addToPanel:         localState.addToPanel,
      panelOnly:          localState.panelOnly,
    });
  });

  btnRow.append(cancelBtn, confirmBtn);
  modal.appendChild(btnRow);
  document.body.appendChild(modal);
}


// ── Header chip ───────────────────────────────────────────────────────────────

function baseStatusColour(base, gamedata) {
  const { inputs, consumables } = calcBaseNeeds(base, gamedata);
  const relevant = [
    ...(_settings.includeInputs      ? inputs      : []),
    ...(_settings.includeConsumables ? consumables : []),
  ];
  const allDays  = relevant.map(r => r.days).filter(d => isFinite(d));
  const worstDay = allDays.length ? Math.min(...allDays) : Infinity;
  return { col: daysColour(worstDay), worstDay };
}

function buildHeaderChip(base, gamedata) {
  const { col, worstDay } = baseStatusColour(base, gamedata);
  const daysStr  = fmtDays(worstDay);

  const chip = document.createElement('div');
  chip.dataset.baseId = String(base.id);
  chip.style.cssText = 'display:flex;align-items:center;gap:5px;padding:0 8px;height:26px;background:#111128;border:1px solid #2a2a4a;border-radius:4px;cursor:pointer;white-space:nowrap;flex-shrink:0;user-select:none;position:relative;';

  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'color:#c0c0da;font-size:12px;';
  nameEl.textContent = base.name;

  const timerEl = document.createElement('span');
  timerEl.style.cssText = `color:${col};font-weight:600;font-size:11px;`;
  timerEl.textContent = daysStr;

  const cartBtn = document.createElement('button');
  cartBtn.innerHTML = '&#128722;';
  cartBtn.title = 'Create wishlist';
  cartBtn.style.cssText = `background:none;border:none;cursor:pointer;font-size:11px;padding:0;margin-left:1px;line-height:1;color:inherit;flex-shrink:0;display:${_settings.showWishlist ? '' : 'none'};transition:transform 0.1s,opacity 0.15s;`;
  cartBtn.addEventListener('mouseenter', () => { cartBtn.style.opacity = '1'; cartBtn.style.transform = 'scale(1.25)'; });
  cartBtn.addEventListener('mouseleave', () => { cartBtn.style.opacity = ''; cartBtn.style.transform = ''; });
  cartBtn.addEventListener('mousedown',  () => { cartBtn.style.transform = 'scale(0.85)'; });
  cartBtn.addEventListener('mouseup',    () => { cartBtn.style.transform = 'scale(1.25)'; });
  cartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleCreateWishlist(base, gamedata, cartBtn);
  });

  chip.appendChild(nameEl);
  chip.appendChild(timerEl);
  chip.appendChild(cartBtn);
  chip.addEventListener('click', () => toggleBaseDetail(base, gamedata));

  return chip;
}

// ── Settings panel ────────────────────────────────────────────────────────────

function buildMiniToggle(initialValue, onChange) {
  const label = document.createElement('label');
  label.style.cssText = 'position:relative;display:inline-block;width:28px;height:16px;flex-shrink:0;cursor:pointer;';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initialValue;
  input.style.cssText = 'opacity:0;width:0;height:0;position:absolute;';

  const track = document.createElement('span');
  const applyTrack = (checked) => {
    track.style.cssText = `position:absolute;inset:0;border-radius:8px;transition:background 0.2s;cursor:pointer;background:${checked ? '#166534' : '#2a2a4a'};`;
  };
  applyTrack(initialValue);

  const knob = document.createElement('span');
  const applyKnob = (checked) => {
    knob.style.cssText = `position:absolute;width:10px;height:10px;border-radius:50%;top:3px;transition:transform 0.2s,background 0.2s;background:${checked ? '#22c55e' : '#6b6b8a'};transform:translateX(${checked ? '15px' : '3px'});`;
  };
  applyKnob(initialValue);

  input.addEventListener('change', () => {
    applyTrack(input.checked);
    applyKnob(input.checked);
    onChange(input.checked);
  });

  track.appendChild(knob);
  label.appendChild(input);
  label.appendChild(track);

  // Programmatic off — used for mutually-exclusive toggle pairs
  label._setOff = () => {
    input.checked = false;
    applyTrack(false);
    applyKnob(false);
  };

  return label;
}

function buildSettingsPanel() {
  const panel = document.createElement('div');
  panel.id = GT_SETTINGS_ID;
  Object.assign(panel.style, {
    position: 'fixed', top: `${HEADER_H}px`, right: '0',
    width: '220px',
    maxHeight: `calc(100vh - ${HEADER_H}px - ${getGameBottomNavH()}px)`,
    overflowY: 'auto',
    background: '#0a0a18', border: '1px solid #2a2a4a',
    borderTop: 'none', borderRadius: '0 0 0 8px',
    padding: '10px 12px 12px',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#b0b0cc',
    zIndex: '2147483645', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
  });

  // Title
  const title = mkLabel('Settings', 'margin-bottom:6px;');
  panel.appendChild(title);

  // ── API Key section ───────────────────────────────────────────────────────
  const keySection = document.createElement('div');
  keySection.style.cssText = 'margin-bottom:2px;';

  const keyHeaderRow = document.createElement('div');
  keyHeaderRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:5px;';

  const keyLabel = mkLabel('API Key');

  const keyHelp = document.createElement('span');
  keyHelp.textContent = '?';
  keyHelp.title = 'Limited API key required for Guild Trade tab. Extended API Key required for Guild Trade & Wishlisting.';
  keyHelp.style.cssText = 'color:#6b6b8a;font-size:9px;border:1px solid #2a2a4a;border-radius:50%;width:13px;height:13px;display:inline-flex;align-items:center;justify-content:center;cursor:default;flex-shrink:0;';

  keyHeaderRow.appendChild(keyLabel);
  keyHeaderRow.appendChild(keyHelp);
  keySection.appendChild(keyHeaderRow);

  const keyMissing = document.createElement('div');

  const keyInputWrap = document.createElement('div');
  keyInputWrap.style.cssText = 'display:flex;gap:4px;';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.placeholder = 'Paste API key\u2026';
  keyInput.style.cssText = 'flex:1;min-width:0;background:#1a1a30;border:1px solid #2a2a4a;border-radius:4px;color:#d8d8f0;font-size:11px;padding:3px 6px;outline:none;';

  const keySaveBtn = document.createElement('button');
  keySaveBtn.textContent = 'Save';
  keySaveBtn.style.cssText = 'background:#166534;color:#22c55e;border:none;border-radius:4px;font-size:11px;padding:3px 8px;cursor:pointer;flex-shrink:0;';

  keyInputWrap.appendChild(keyInput);
  keyInputWrap.appendChild(keySaveBtn);
  keyMissing.appendChild(keyInputWrap);

  const keySavedRow = document.createElement('div');
  keySavedRow.style.cssText = 'display:none;align-items:center;justify-content:space-between;';

  const keySavedSpan = document.createElement('span');
  keySavedSpan.style.cssText = 'color:#22c55e;font-size:11px;';
  keySavedSpan.textContent = '\u2713 API key saved';

  const keyClearBtn = document.createElement('button');
  keyClearBtn.textContent = 'Clear';
  keyClearBtn.style.cssText = 'background:none;border:1px solid #2a2a4a;border-radius:3px;color:#6b6b8a;font-size:10px;padding:2px 6px;cursor:pointer;';

  keySavedRow.appendChild(keySavedSpan);
  keySavedRow.appendChild(keyClearBtn);

  keySection.appendChild(keyMissing);
  keySection.appendChild(keySavedRow);
  panel.appendChild(keySection);

  chrome.storage.local.get(['gtExtApiKey'], ({ gtExtApiKey }) => {
    if (gtExtApiKey) {
      keyMissing.style.display = 'none';
      keySavedRow.style.display = 'flex';
    }
  });

  keySaveBtn.addEventListener('click', () => {
    const val = keyInput.value.trim();
    if (!val) return;
    chrome.storage.local.set({ gtExtApiKey: val }, () => {
      keyInput.value = '';
      keyMissing.style.display = 'none';
      keySavedRow.style.display = 'flex';
    });
  });

  keyClearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('gtExtApiKey', () => {
      keySavedRow.style.display = 'none';
      keyMissing.style.display = '';
    });
  });

  // ── Helper: collapsible section ───────────────────────────────────────────
  function mkCollapsible(labelText, startOpen = false) {
    const wrap = document.createElement('div');
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid #1a1a30;margin:6px 0 0;';
    wrap.appendChild(sep);

    let open = startOpen;
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0 4px;cursor:pointer;';

    const lbl = mkLabel(labelText);

    const arrow = document.createElement('span');
    arrow.style.cssText = 'color:#6b6b8a;font-size:10px;';
    arrow.textContent = open ? '\u25b4' : '\u25be';

    hdr.appendChild(lbl); hdr.appendChild(arrow);
    wrap.appendChild(hdr);

    const body = document.createElement('div');
    body.style.display = open ? 'block' : 'none';
    wrap.appendChild(body);

    hdr.addEventListener('click', () => {
      open = !open;
      body.style.display = open ? 'block' : 'none';
      arrow.textContent = open ? '\u25b4' : '\u25be';
    });

    panel.appendChild(wrap);
    return body;
  }

  // ── Helper: number input row ──────────────────────────────────────────────
  function mkNumRow(container, label, labelColor, settingKey, min, step, isPositive) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:2px 0;';
    const lbl = document.createElement('span');
    lbl.style.cssText = `color:${labelColor};font-size:11px;`;
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = String(min); inp.step = String(step);
    inp.value = String(_settings[settingKey]);
    inp.style.cssText = 'width:52px;background:#1a1a30;border:1px solid #2a2a4a;border-radius:4px;color:#d8d8f0;font-size:11px;padding:3px 6px;text-align:right;outline:none;';
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (isFinite(v) && (isPositive ? v > 0 : v >= 0)) { _settings[settingKey] = v; saveSettings(); }
      else inp.value = String(_settings[settingKey]);
    });
    row.appendChild(lbl); row.appendChild(inp);
    container.appendChild(row);
  }

  // Cache header element reference for use in toggle callbacks
  const _panelHeader = document.getElementById(GT_HEADER_ID);

  // ── Helper: chip-rebuilding toggle row ────────────────────────────────────
  function mkChipToggleRow(container, label, settingKey) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 0;';
    const lbl = document.createElement('span');
    lbl.style.color = '#c0c0da';
    lbl.textContent = label;
    const tog = buildMiniToggle(_settings[settingKey], (val) => {
      _settings[settingKey] = val;
      saveSettings();
      const header = _panelHeader;
      if (header && _loadedHeaderBases && _loadedHeaderGamedata) {
        header.querySelectorAll('[data-base-id]').forEach(chip => {
          const base = _loadedHeaderBases.find(b => String(b.id) === chip.dataset.baseId);
          if (base) chip.replaceWith(buildHeaderChip(base, _loadedHeaderGamedata));
        });
        if (_detailBaseId) {
          const base = _loadedHeaderBases.find(b => String(b.id) === _detailBaseId);
          document.getElementById(GT_DETAIL_ID)?.remove();
          if (base) document.body.appendChild(buildDetailPanel(base, _loadedHeaderGamedata));
        }
      }
    });
    row.appendChild(lbl); row.appendChild(tog);
    container.appendChild(row);
  }

  // ── Wishlisting section (collapsible) ─────────────────────────────────────
  const wishBody = mkCollapsible('Wishlisting', false);

  mkNumRow(wishBody, 'Target stock (days)', '#c0c0da', 'targetDays', 0.1, 0.1, true);

  const colSubtitle = document.createElement('div');
  colSubtitle.style.cssText = 'color:#6b6b8a;font-size:10px;margin:5px 0 2px;';
  colSubtitle.textContent = 'Colour thresholds (hours)';
  wishBody.appendChild(colSubtitle);

  mkNumRow(wishBody, '\u25cf Red below',   COL_CRIT, 'critHours', 0, 1, false);
  mkNumRow(wishBody, '\u25cf Amber below', COL_LOW,  'lowHours',  0, 1, false);

  mkChipToggleRow(wishBody, 'Subtract current stock', 'includeStock');
  mkChipToggleRow(wishBody, 'Production inputs',      'includeInputs');
  mkChipToggleRow(wishBody, 'Worker consumables',     'includeConsumables');

  // Bases visibility section — under a collapsible expander
  if (_loadedHeaderBases?.length) {
    const sep2 = document.createElement('div');
    sep2.style.cssText = 'border-top:1px solid #1a1a30;margin:8px 0 0;';
    panel.appendChild(sep2);

    // Expander header row
    let basesExpanded = false;
    const expRow = document.createElement('div');
    expRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 0 5px;cursor:pointer;';

    const expLabel = mkLabel(`Overview (${_loadedHeaderBases.length})`);

    const expArrow = document.createElement('span');
    expArrow.style.cssText = 'color:#6b6b8a;font-size:10px;';
    expArrow.textContent = '\u25be'; // ▾

    expRow.appendChild(expLabel);
    expRow.appendChild(expArrow);
    panel.appendChild(expRow);

    // Collapsible list
    const basesList = document.createElement('div');
    basesList.style.cssText = 'display:none;';
    panel.appendChild(basesList);

    const basesNote = document.createElement('div');
    basesNote.style.cssText = 'display:none;color:#4a4a6a;font-size:10px;line-height:1.4;padding-bottom:4px;';
    basesNote.textContent = 'Hidden bases are excluded from summary and header view only.';
    basesList.appendChild(basesNote);

    expRow.addEventListener('click', () => {
      basesExpanded = !basesExpanded;
      basesList.style.display = basesExpanded ? 'block' : 'none';
      basesNote.style.display = basesExpanded ? 'block' : 'none';
      expArrow.textContent = basesExpanded ? '\u25b4' : '\u25be';
    });

    // Sort by time left toggle
    const sortRow = document.createElement('div');
    sortRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0 6px;border-bottom:1px solid #1a1a30;margin-bottom:2px;';
    const sortLbl = document.createElement('span');
    sortLbl.style.cssText = 'color:#9090b0;font-size:11px;';
    sortLbl.textContent = 'Sort by time left';
    const sortTog = buildMiniToggle(_settings.sortByTimeLeft, (on) => {
      _settings.sortByTimeLeft = on;
      saveSettings();
      rebuildBaseRows();
      refreshHeaderChips();
    });
    sortRow.appendChild(sortLbl);
    sortRow.appendChild(sortTog);
    basesList.appendChild(sortRow);

    const refreshHeaderChips = () => {
      const chipArea = _panelHeader?.querySelector('[data-chip-area]');
      if (!chipArea || !_loadedHeaderGamedata) return;
      chipArea.querySelectorAll('[data-base-id]').forEach(c => c.remove());
      const overflowBadge = chipArea.lastElementChild;
      const sorted = sortBases(_loadedHeaderBases, _loadedHeaderGamedata)
        .filter(b => !_settings.hiddenBases.includes(String(b.id)));
      for (const b of sorted) chipArea.insertBefore(buildHeaderChip(b, _loadedHeaderGamedata), overflowBadge);
      _syncOverflowBadge?.();
    };

    const rebuildBaseRows = () => {
      [...basesList.children].forEach(c => {
        if (c !== basesNote && c !== sortRow) c.remove();
      });
      const sortByTime = _settings.sortByTimeLeft;
      for (const base of sortBases(_loadedHeaderBases, _loadedHeaderGamedata)) {
        const bid = String(base.id);
        const row = document.createElement('div');
        row.dataset.dragId = bid;
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;';
        row.draggable = !sortByTime;

        const handle = document.createElement('span');
        handle.textContent = '\u283f';
        handle.style.cssText = `color:#6b6b8a;font-size:13px;cursor:${sortByTime ? 'default' : 'grab'};flex-shrink:0;opacity:${sortByTime ? 0.3 : 1};user-select:none;`;

        const lbl = document.createElement('span');
        lbl.style.cssText = `flex:1;color:${sortByTime ? '#4a4a6a' : '#c0c0da'};font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:${sortByTime ? 0.5 : 1};`;
        lbl.textContent = base.name;

        const tog = buildMiniToggle(!_settings.hiddenBases.includes(bid), (visible) => {
          if (visible) {
            _settings.hiddenBases = _settings.hiddenBases.filter(id => id !== bid);
          } else {
            if (!_settings.hiddenBases.includes(bid)) _settings.hiddenBases.push(bid);
          }
          saveSettings();
          refreshHeaderChips();
        });

        row.appendChild(handle);
        row.appendChild(lbl);
        row.appendChild(tog);
        basesList.appendChild(row);

        if (!sortByTime) {
          row.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', bid);
            e.dataTransfer.effectAllowed = 'move';
            row.style.opacity = '0.4';
          });
          row.addEventListener('dragend', () => { row.style.opacity = ''; });
          row.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.style.borderTop = '2px solid #4a4aaa';
          });
          row.addEventListener('dragleave', () => { row.style.borderTop = ''; });
          row.addEventListener('drop', e => {
            e.preventDefault();
            row.style.borderTop = '';
            const fromId = e.dataTransfer.getData('text/plain');
            if (fromId === bid) return;
            const allRows = [...basesList.querySelectorAll('[data-drag-id]')];
            const order = allRows.map(r => r.dataset.dragId);
            const fi = order.indexOf(fromId);
            const ti = order.indexOf(bid);
            if (fi === -1 || ti === -1) return;
            order.splice(fi, 1);
            order.splice(ti, 0, fromId);
            _settings.baseOrder = order;
            saveSettings();
            rebuildBaseRows();
            refreshHeaderChips();
          });
        }
      }
    };

    rebuildBaseRows();
  }

  // Feature visibility section
  const sepFeat = document.createElement('div');
  sepFeat.style.cssText = 'border-top:1px solid #1a1a30;margin:8px 0 0;';
  panel.appendChild(sepFeat);

  // Collapsible header
  let featExpanded = true;
  const featHeader = document.createElement('div');
  featHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 0 5px;cursor:pointer;user-select:none;';
  const featHeaderLbl = mkLabel('Feature Visibility', '');
  const featChevron = document.createElement('span');
  featChevron.style.cssText = 'color:#6b6b8a;font-size:10px;transition:transform 0.15s;';
  featChevron.textContent = '▾';
  featHeader.appendChild(featHeaderLbl);
  featHeader.appendChild(featChevron);
  panel.appendChild(featHeader);

  const featBody = document.createElement('div');
  panel.appendChild(featBody);

  featHeader.addEventListener('click', () => {
    featExpanded = !featExpanded;
    featBody.style.display = featExpanded ? '' : 'none';
    featChevron.style.transform = featExpanded ? '' : 'rotate(-90deg)';
  });

  function buildFeatToggle(container, key, label) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 0;';
    const lbl = document.createElement('span');
    lbl.style.color = '#c0c0da';
    lbl.textContent = label;
    const tog = buildMiniToggle(_settings[key], (val) => {
      _settings[key] = val;
      saveSettings();
      if (key === 'showCosts') {
        if (_panelHeader && _loadedHeaderBases && _loadedHeaderGamedata) {
          _panelHeader.querySelectorAll('[data-base-id]').forEach(chip => {
            const base = _loadedHeaderBases.find(b => String(b.id) === chip.dataset.baseId);
            if (base) chip.replaceWith(buildHeaderChip(base, _loadedHeaderGamedata));
          });
          if (_detailBaseId) {
            const base = _loadedHeaderBases.find(b => String(b.id) === _detailBaseId);
            document.getElementById(GT_DETAIL_ID)?.remove();
            if (base) document.body.appendChild(buildDetailPanel(base, _loadedHeaderGamedata));
          }
        }
      } else if (key === 'showGuildPrices') {
        if (val) run(); else removeInjection();
      } else {
        loadAndInjectHeader();
      }
    });
    row.appendChild(lbl);
    row.appendChild(tog);
    container.appendChild(row);
  }

  const mainToggles = [
    { key: 'showGuildPrices',   label: 'Guild prices' },
    { key: 'showGTE',           label: 'Guild trade' },
    { key: 'showSummary',       label: 'Summary panel' },
    { key: 'showAssets',        label: 'Cash & assets panel' },
    { key: 'showWishlistAll',   label: 'Wishlist all panel' },
    { key: 'showWishlist',      label: '1-click wishlisting' },
    { key: 'showWishlistPanel', label: 'Wishlist panel tab' },
    { key: 'showFlightCosts',   label: 'Flight cost rows' },
  ];
  for (const { key, label } of mainToggles) buildFeatToggle(featBody, key, label);

  // Custom Prices button
  const sepPrices = document.createElement('div');
  sepPrices.style.cssText = 'border-top:1px solid #1a1a30;margin:10px 0 8px;';
  panel.appendChild(sepPrices);

  // GT-Companion deactivate
  const compDeactivateBtn = document.createElement('button');
  compDeactivateBtn.style.width = '100%';
  compDeactivateBtn.style.textAlign = 'left';
  compDeactivateBtn.style.marginBottom = '6px';
  const _updateCompDeactivateBtn = () => {
    compDeactivateBtn.textContent = _companionEnabled ? '⊘ Deactivate GT-Companion' : '○ GT-Companion (inactive)';
    _gtBtn(compDeactivateBtn, 'neutral');
    compDeactivateBtn.style.width = '100%';
    compDeactivateBtn.style.textAlign = 'left';
    compDeactivateBtn.style.marginBottom = '6px';
    compDeactivateBtn.style.opacity = _companionEnabled ? '1' : '0.5';
    compDeactivateBtn.disabled = !_companionEnabled;
  };
  _updateCompDeactivateBtn();
  compDeactivateBtn.addEventListener('mouseenter', () => { if (_companionEnabled) { compDeactivateBtn.style.color = '#f87171'; compDeactivateBtn.style.borderColor = '#6b2a2a'; } });
  compDeactivateBtn.addEventListener('mouseleave', () => { if (_companionEnabled) _updateCompDeactivateBtn(); });
  compDeactivateBtn.addEventListener('click', () => {
    if (!_companionEnabled) return;
    _companionEnabled = false;
    _companionSnapshots = [];
    _clearCompanionTargets();
    _baseSnapshotMap = {};
    chrome.storage.local.set({ gtCompanionEnabled: false, gtCompanionBaseMap: {} });
    injectSlotBadges();
    _updateModalTarget();
    _updateCompDeactivateBtn();
    const bar = document.getElementById(GT_COMPANION_BAR_ID);
    if (bar) _renderCompanionBarState(bar);
  });
  panel.appendChild(compDeactivateBtn);

  const customPricesBtn = document.createElement('button');
  customPricesBtn.textContent = '\u{1F4B2} Custom Prices';
  customPricesBtn.style.cssText = 'width:100%;background:#1a1a30;border:1px solid #2a2a4a;border-radius:4px;color:#9090b0;font-size:11px;padding:5px 8px;cursor:pointer;text-align:left;transition:color 0.15s,border-color 0.15s;';
  customPricesBtn.addEventListener('mouseenter', () => { customPricesBtn.style.color = '#d8d8f0'; customPricesBtn.style.borderColor = '#4a4a6a'; });
  customPricesBtn.addEventListener('mouseleave', () => { customPricesBtn.style.color = '#9090b0'; customPricesBtn.style.borderColor = '#2a2a4a'; });
  customPricesBtn.addEventListener('click', () => openCustomPricesModal());
  panel.appendChild(customPricesBtn);

  // Visit link
  const sepLink = document.createElement('div');
  sepLink.style.cssText = 'border-top:1px solid #1a1a30;margin:10px 0 8px;';
  panel.appendChild(sepLink);

  const visitBtn = document.createElement('a');
  visitBtn.href = 'https://galactic-track.com';
  visitBtn.target = '_blank';
  visitBtn.rel = 'noopener noreferrer';
  visitBtn.textContent = 'Visit Galactic-Track.com \u2197';
  visitBtn.style.cssText = 'display:block;text-align:center;font-size:11px;color:#6366f1;text-decoration:none;padding:4px 0;border-radius:4px;transition:color 0.15s;';
  visitBtn.addEventListener('mouseenter', () => { visitBtn.style.color = '#818cf8'; });
  visitBtn.addEventListener('mouseleave', () => { visitBtn.style.color = '#6366f1'; });
  panel.appendChild(visitBtn);

  const ver = document.createElement('div');
  ver.style.cssText = 'text-align:center;font-size:10px;color:#2a2a4a;margin-top:6px;';
  ver.textContent = 'v0.5';
  panel.appendChild(ver);

  return panel;
}

let _settingsOpen = false;
let _headerCollapsed = false;
function toggleSettingsPanel() {
  const wasOpen = _settingsOpen;
  closeAllPanels();
  if (!wasOpen) {
    document.body.appendChild(buildSettingsPanel());
    _settingsOpen = true;
  }
}

// ── Custom Prices modal ───────────────────────────────────────────────────────

async function openCustomPricesModal() {
  document.getElementById(GT_CUSTOM_PRICES_ID)?.remove();

  // Kick off avg price fetch in background
  fetchAvgPrices();

  const gamedata = await loadGamedata();
  const sellable = (gamedata.materials ?? [])
    .filter(m => m.cp > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = GT_CUSTOM_PRICES_ID;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0',
    background: 'rgba(0,0,0,0.72)',
    zIndex: '2147483646',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'system-ui, sans-serif',
  });

  // Modal box
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    background: '#0d0d20',
    border: '1px solid #2a2a4a',
    borderRadius: '10px',
    width: '560px',
    maxWidth: '96vw',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    overflow: 'hidden',
    fontSize: '12px',
    color: '#b0b0cc',
  });

  // ── Header ───────────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid #1a1a30;flex-shrink:0;gap:8px;flex-wrap:wrap;';

  const titleSpan = document.createElement('span');
  titleSpan.style.cssText = 'font-size:13px;font-weight:700;color:#d8d8f0;white-space:nowrap;';
  titleSpan.textContent = 'Custom Prices';

  // Mode selector
  const modeWrap = document.createElement('div');
  modeWrap.style.cssText = 'display:flex;align-items:center;gap:3px;background:#1a1a30;border:1px solid #2a2a4a;border-radius:5px;padding:2px;';

  const mkModeBtn = (label, mode) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.mode = mode;
    const active = _settings.priceMode === mode;
    btn.style.cssText = `border:none;border-radius:4px;font-size:11px;padding:3px 8px;cursor:pointer;transition:background 0.15s,color 0.15s;background:${active ? '#2a2a4a' : 'transparent'};color:${active ? '#d8d8f0' : '#6b6b8a'};`;
    btn.addEventListener('click', () => {
      _settings.priceMode = mode;
      saveSettings();
      modal.querySelectorAll('[data-mode]').forEach(b => {
        const isActive = b.dataset.mode === mode;
        b.style.background = isActive ? '#2a2a4a' : 'transparent';
        b.style.color = isActive ? '#d8d8f0' : '#6b6b8a';
      });
    });
    return btn;
  };
  modeWrap.appendChild(mkModeBtn('Current', 'current'));
  modeWrap.appendChild(mkModeBtn('Average', 'average'));

  // Reset All button
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset All';
  resetBtn.style.cssText = 'background:none;border:1px solid #3a1a1a;border-radius:4px;color:#ef4444;font-size:11px;padding:3px 8px;cursor:pointer;white-space:nowrap;';
  resetBtn.addEventListener('click', () => {
    _settings.customPrices = {};
    saveSettings();
    modal.querySelectorAll('input[data-mat-id]').forEach(inp => { inp.value = ''; inp.style.borderColor = '#2a2a4a'; });
  });

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  closeBtn.style.cssText = 'background:none;border:none;color:#6b6b8a;font-size:18px;cursor:pointer;line-height:1;padding:0 2px;flex-shrink:0;';
  closeBtn.addEventListener('click', () => overlay.remove());

  hdr.appendChild(titleSpan);
  hdr.appendChild(modeWrap);
  hdr.appendChild(resetBtn);
  hdr.appendChild(closeBtn);
  modal.appendChild(hdr);

  // ── Search bar ────────────────────────────────────────────────────────────
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:8px 14px;border-bottom:1px solid #1a1a30;flex-shrink:0;';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search materials\u2026';
  searchInput.style.cssText = 'width:100%;background:#1a1a30;border:1px solid #2a2a4a;border-radius:5px;color:#d8d8f0;font-size:12px;padding:5px 8px;outline:none;box-sizing:border-box;';
  searchWrap.appendChild(searchInput);
  modal.appendChild(searchWrap);

  // ── Column headers ────────────────────────────────────────────────────────
  const colHdr = document.createElement('div');
  colHdr.style.cssText = 'display:grid;grid-template-columns:1fr 90px 90px 90px;gap:6px;padding:4px 14px;border-bottom:1px solid #1a1a30;flex-shrink:0;';
  ['Material', 'Current', 'Average', 'Custom'].forEach((lbl, i) => {
    const s = document.createElement('span');
    s.style.cssText = `color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;${i > 0 ? 'text-align:right;' : ''}`;
    s.textContent = lbl;
    colHdr.appendChild(s);
  });
  modal.appendChild(colHdr);

  // ── Scrollable list ───────────────────────────────────────────────────────
  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1;padding:4px 14px 10px;';

  const buildRows = (filter = '') => {
    list.innerHTML = '';
    const q = filter.toLowerCase();
    for (const mat of sellable) {
      if (q && !mat.name.toLowerCase().includes(q)) continue;

      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 90px 90px 90px;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid #0f0f22;';

      // Name + icon
      const nameCell = document.createElement('div');
      nameCell.style.cssText = 'display:flex;align-items:center;gap:5px;min-width:0;';
      const ic = makeIcon(mat.name, 14);
      if (ic) nameCell.appendChild(ic);
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'color:#c0c0da;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameSpan.textContent = mat.name;
      nameCell.appendChild(nameSpan);

      // Current price
      const curCell = document.createElement('span');
      curCell.style.cssText = 'color:#9090b0;font-size:11px;text-align:right;white-space:nowrap;';
      const curPrice = _priceMap?.get(mat.id);
      curCell.textContent = curPrice ? fmtCr(curPrice) : '\u2014';

      // Average price (loaded async — fill in when ready)
      const avgCell = document.createElement('span');
      avgCell.style.cssText = 'color:#9090b0;font-size:11px;text-align:right;white-space:nowrap;';
      avgCell.dataset.avgFor = mat.id;
      const avgPrice = _avgPriceMap?.get(mat.id);
      avgCell.textContent = avgPrice ? fmtCr(avgPrice) : '\u2014';

      // Custom price input
      const customInp = document.createElement('input');
      customInp.type = 'number';
      customInp.min = '0';
      customInp.step = '0.01';
      customInp.placeholder = '\u2014';
      customInp.dataset.matId = mat.id;
      const existingCustom = _settings.customPrices?.[mat.id];
      if (existingCustom > 0) customInp.value = existingCustom;
      customInp.style.cssText = 'width:100%;background:#1a1a30;border:1px solid #2a2a4a;border-radius:4px;color:#d8d8f0;font-size:11px;padding:2px 5px;text-align:right;outline:none;box-sizing:border-box;';
      customInp.addEventListener('change', () => {
        const v = parseFloat(customInp.value);
        if (!_settings.customPrices) _settings.customPrices = {};
        if (isFinite(v) && v > 0) {
          _settings.customPrices[mat.id] = v;
          customInp.style.borderColor = '#6366f1';
        } else {
          delete _settings.customPrices[mat.id];
          customInp.value = '';
          customInp.style.borderColor = '#2a2a4a';
        }
        saveSettings();
      });
      if (existingCustom > 0) customInp.style.borderColor = '#6366f1';

      row.appendChild(nameCell);
      row.appendChild(curCell);
      row.appendChild(avgCell);
      row.appendChild(customInp);
      list.appendChild(row);
    }
  };

  buildRows();
  modal.appendChild(list);

  // Fill avg prices once loaded
  const avgPollInterval = setInterval(() => {
    if (!_avgPriceMap) return;
    clearInterval(avgPollInterval);
    modal.querySelectorAll('[data-avg-for]').forEach(cell => {
      const id = Number(cell.dataset.avgFor);
      const avg = _avgPriceMap.get(id);
      cell.textContent = avg ? fmtCr(avg) : '\u2014';
    });
  }, 400);

  searchInput.addEventListener('input', () => buildRows(searchInput.value));

  // Close on overlay click
  overlay.addEventListener('click', e => { if (e.target === overlay) { clearInterval(avgPollInterval); overlay.remove(); } });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  searchInput.focus();
}

// Cached references for live chip updates
let _loadedHeaderBases    = null;
let _loadedHeaderGamedata = null;

// Sort: respect sortByTimeLeft > baseOrder > numeric prefix > alphabetical
function sortBases(bases, gamedata) {
  if (_settings.sortByTimeLeft && gamedata) {
    return [...bases].sort((a, b) => {
      const { worstDay: wa } = baseStatusColour(a, gamedata);
      const { worstDay: wb } = baseStatusColour(b, gamedata);
      return wa - wb;
    });
  }
  if (_settings.baseOrder?.length) {
    const idx = id => {
      const i = _settings.baseOrder.indexOf(String(id));
      return i === -1 ? Infinity : i;
    };
    return [...bases].sort((a, b) => idx(a.id) - idx(b.id));
  }
  const leadNum = s => { const m = s.match(/(\d+)/); return m ? parseInt(m[1], 10) : Infinity; };
  return [...bases].sort((a, b) => {
    const na = leadNum(a.name), nb = leadNum(b.name);
    if (na !== nb) return na - nb;
    return a.name.localeCompare(b.name);
  });
}

// ── Cash / assets panel ───────────────────────────────────────────────────────

const fmtCr = n => '$' + Math.round(n).toLocaleString();

function mkPanelBase(id, rightAligned = true) {
  const p = document.createElement('div');
  p.id = id;
  Object.assign(p.style, {
    position: 'fixed', top: `${HEADER_H}px`,
    [rightAligned ? 'right' : 'left']: '0',
    width: '260px', maxHeight: `calc(100vh - ${HEADER_H}px - ${getGameBottomNavH()}px)`, overflowY: 'auto',
    background: '#0a0a18', border: '1px solid #2a2a4a',
    borderTop: 'none',
    borderRadius: rightAligned ? '0 0 0 8px' : '0 8px 8px 0',
    padding: '10px 12px 12px',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#b0b0cc',
    zIndex: '2147483645', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
  });
  return p;
}

function mkPanelTitle(text) {
  const t = document.createElement('div');
  t.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;';
  t.textContent = text;
  return t;
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'landed';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}hr ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function mkSep() {
  const s = document.createElement('div');
  s.style.cssText = 'border-top:1px solid #1a1a30;margin:6px 0;';
  return s;
}

function mkRow(label, value, valueCol) {
  const r = document.createElement('div');
  r.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;';
  const l = document.createElement('span'); l.style.color = '#c0c0da'; l.textContent = label;
  const v = document.createElement('span');
  v.style.cssText = `color:${valueCol ?? '#9090b0'};font-size:11px;text-align:right;`;
  v.textContent = value;
  r.appendChild(l); r.appendChild(v);
  return r;
}

function attachTooltip(el, buildFn, preferLeft = false) {
  let tip = null;
  el.addEventListener('mouseenter', () => {
    tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;z-index:2147483647;background:#0d0d20;border:1px solid #2a2a4a;border-radius:6px;padding:8px 10px;font-size:11px;color:#b0b0cc;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.6);';
    if (buildFn(tip) === false) { tip = null; return; }
    document.body.appendChild(tip);
  });
  el.addEventListener('mousemove', (e) => {
    if (!tip) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = preferLeft
      ? Math.max(e.clientX - w - 12, 8) + 'px'
      : Math.min(e.clientX + 12, window.innerWidth - w - 8) + 'px';
    tip.style.top  = Math.min(e.clientY + 12, window.innerHeight - h - 8) + 'px';
  });
  el.addEventListener('mouseleave', () => { tip?.remove(); tip = null; });
}

function mkLabel(text, extra) {
  const d = document.createElement('div');
  d.style.cssText = `color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;${extra ?? ''}`;
  d.textContent = text;
  return d;
}

function mkTipTitle(text) {
  const d = document.createElement('div');
  d.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;';
  d.textContent = text;
  return d;
}

// Creates a flex row: [icon] qtyStr (left)   valStr (right)
function mkIconLine(name, qtyStr, valStr) {
  const line = document.createElement('div');
  line.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0;';
  const left = document.createElement('div');
  left.style.cssText = 'display:flex;align-items:center;gap:5px;';
  const ic = makeIcon(name, 14);
  if (ic) left.appendChild(ic);
  const lbl = document.createElement('span');
  lbl.style.color = '#c0c0da';
  lbl.textContent = qtyStr;
  left.appendChild(lbl);
  line.appendChild(left);
  if (valStr) {
    const val = document.createElement('span');
    val.style.cssText = 'color:#9090b0;white-space:nowrap;';
    val.textContent = valStr;
    line.appendChild(val);
  }
  return line;
}

// ── Flight panel ──────────────────────────────────────────────────────────────

let _flightOpen = false;

async function openFlightPanel() {
  closeAllPanels();
  const gamedata  = _loadedHeaderGamedata;
  // Always fetch fresh ship data from local API when opening
  const freshCompany = await requestGTLocalAPI('getMyCompany');
  if (freshCompany?.id) {
    const perks = _companyData?.perks;
    _companyData = perks ? { ...freshCompany, perks } : freshCompany;
    _companyDataTs = Date.now();
  }
  const company   = _companyData;
  const ships     = company?.ships ?? [];
  const guildData = _guildData;

  const panel = mkPanelBase(GT_FLIGHT_ID, true);
  panel.appendChild(mkPanelTitle('Flight Calculator'));

  if (!gamedata || !ships.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#6b6b8a;font-style:italic;font-size:11px;';
    msg.textContent = ships.length ? 'Gamedata not loaded.' : 'No ships found.';
    panel.appendChild(msg);
    document.body.appendChild(panel);
    _flightOpen = true;
    return;
  }

  const emitterMap = new Map((gamedata.shipEmitters ?? []).map(e => [e.type, e]));
  const reactorMap = new Map((gamedata.shipReactors ?? []).map(r => [r.type, r]));
  const matMap     = new Map((gamedata.materials    ?? []).map(m => [m.id, m]));

  // Flat list of all planets with their coords for search
  const allPlanets = [];
  for (const sys of gamedata.systems ?? []) {
    for (const p of sys.planets ?? []) {
      if (p?.name) allPlanets.push(p);
    }
  }

  const startBonus = companyStartingBonus(company?.fDate);

  // Guild Flight Center level → +3% speed per level (may update async if _guildData not yet loaded)
  let flightCenterLevel = (guildData?.projects ?? []).find(p => p.type === 3)?.level ?? 0;
  let guildSpeedBonus   = 1 + flightCenterLevel * 0.03;

  // Perk multipliers
  const flightPerks     = calcFlightPerks(company, gamedata.perks);
  const fuelSavingMult  = 1 + flightPerks.fuelSavingPct / 100;
  const degradationMult = 1 + flightPerks.degradationPct / 100;
  const perkSpeedMult   = 1 + flightPerks.speedPct / 100;

  // Combined speed multiplier: starting bonus × guild flight center × perk speed
  let totalSpeedMult = startBonus * guildSpeedBonus * perkSpeedMult;

  const REPAIR_KIT_MAT_ID = 113;

  // ── Ship list ──────────────────────────────────────────────────────────────
  const shipLabel = mkLabel('Select Ship', 'margin-bottom:4px;');
  panel.appendChild(shipLabel);

  let selectedShip = null;
  let selectedCargoWeight = 0;

  // Sort ships: docked first (alphabetical), then in-flight (alphabetical)
  const sortedShips = [...ships].sort((a, b) => {
    const af = !!a.flight, bf = !!b.flight;
    if (af !== bf) return af ? 1 : -1;
    return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true });
  });

  // Custom ship picker — native <select> was unreliable cross-browser with live countdowns
  const shipWrap = document.createElement('div');
  shipWrap.style.cssText = 'position:relative;margin-bottom:8px;';

  const shipBtn = document.createElement('div');
  shipBtn.style.cssText = 'width:100%;background:#0a0a18;border:1px solid #2a2a4a;border-radius:4px;color:#6b6b8a;font-size:11px;padding:5px 8px;font-family:inherit;box-sizing:border-box;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;';
  const shipBtnLabel = document.createElement('span');
  shipBtnLabel.textContent = 'Choose a ship…';
  const shipBtnArrow = document.createElement('span');
  shipBtnArrow.textContent = '▾';
  shipBtnArrow.style.cssText = 'font-size:10px;color:#6b6b8a;';
  shipBtn.appendChild(shipBtnLabel);
  shipBtn.appendChild(shipBtnArrow);

  const shipDropdown = document.createElement('div');
  shipDropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#0d0d20;border:1px solid #2a2a4a;border-radius:4px;max-height:200px;overflow-y:auto;z-index:10;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.6);margin-top:2px;';

  const flightCountdownUpdaters = [];

  for (const ship of sortedShips) {
    const inFlight = !!ship.flight;
    const fromPlanet = getPlanetById(gamedata, ship.pId);
    const fromName   = fromPlanet?.name ?? `ID ${ship.pId}`;

    const row = document.createElement('div');
    row.style.cssText = `padding:5px 8px;font-size:11px;cursor:${inFlight ? 'default' : 'pointer'};display:flex;flex-direction:column;gap:1px;border-bottom:1px solid #1a1a30;`;

    const rowTop = document.createElement('div');
    rowTop.style.cssText = `color:${inFlight ? '#4a4a6a' : '#c0c0da'};font-weight:500;`;
    rowTop.textContent = ship.name;

    const rowSub = document.createElement('div');
    rowSub.style.cssText = `font-size:10px;color:${inFlight ? '#3a3a5a' : '#6b6b8a'};`;

    if (inFlight) {
      const destPlanet = getPlanetById(gamedata, ship.flight.destPId);
      const destName   = destPlanet?.name ?? `ID ${ship.flight.destPId}`;
      const aTime      = new Date(ship.flight.aDate).getTime();
      const updateSub  = () => { rowSub.textContent = `✈ ${fromName} → ${destName}  ·  ${fmtCountdown(aTime - Date.now())}`; };
      updateSub();
      flightCountdownUpdaters.push(updateSub);
    } else {
      rowSub.textContent = fromName;
      row.addEventListener('mouseenter', () => { row.style.background = '#111128'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('mousedown', e => e.preventDefault());
      row.addEventListener('click', async () => {
        selectedShip = ship;
        shipBtnLabel.textContent = ship.name;
        shipBtnLabel.style.color = '#c0c0da';
        shipDropdown.style.display = 'none';
        selectedCargoWeight = 0;
        if (ship.warehouseId) {
          const wh = await requestGTLocalAPI('getWarehouse', { warehouseId: ship.warehouseId });
          for (const m of wh?.mats ?? []) {
            const mat = matMap.get(Number(m.id));
            selectedCargoWeight += (m.am ?? 0) * (mat?.weight ?? 0);
          }
        }
        updateInfo();
        recalc();
      });
    }

    row.appendChild(rowTop);
    row.appendChild(rowSub);
    shipDropdown.appendChild(row);
  }

  // Toggle dropdown open/close
  let shipDropdownOpen = false;
  shipBtn.addEventListener('click', () => {
    shipDropdownOpen = !shipDropdownOpen;
    shipDropdown.style.display = shipDropdownOpen ? '' : 'none';
    shipBtnArrow.textContent = shipDropdownOpen ? '▴' : '▾';
  });

  // Close on outside click (panel's own outside-click handler covers this via GT_FLIGHT_ID)
  document.addEventListener('click', function closeShipDrop(e) {
    if (!shipWrap.contains(e.target)) {
      shipDropdownOpen = false;
      shipDropdown.style.display = 'none';
      shipBtnArrow.textContent = '▾';
    }
    if (!document.getElementById(GT_FLIGHT_ID)) document.removeEventListener('click', closeShipDrop);
  });

  // Live countdowns for in-flight ships
  if (flightCountdownUpdaters.length) {
    const countdownInterval = setInterval(() => {
      if (!document.getElementById(GT_FLIGHT_ID)) { clearInterval(countdownInterval); return; }
      flightCountdownUpdaters.forEach(fn => fn());
    }, 1000);
  }

  shipWrap.appendChild(shipBtn);
  shipWrap.appendChild(shipDropdown);
  panel.appendChild(shipWrap);
  panel.appendChild(mkSep());

  // ── Ship info ──────────────────────────────────────────────────────────────
  const infoBox = document.createElement('div');
  infoBox.style.cssText = 'margin-bottom:8px;display:none;';

  const infoRows = {};
  for (const key of ['location','fuel','cargo','condition','bonus']) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;padding:1px 0;';
    const lbl = document.createElement('span'); lbl.style.color = '#6b6b8a';
    const val = document.createElement('span'); val.style.color = '#c0c0da';
    row.appendChild(lbl); row.appendChild(val);
    infoBox.appendChild(row);
    infoRows[key] = { lbl, val };
  }
  infoRows.location.lbl.textContent  = 'Location';
  infoRows.fuel.lbl.textContent      = 'Fuel';
  infoRows.cargo.lbl.textContent     = 'Cargo';
  infoRows.condition.lbl.textContent = 'Condition';
  infoRows.bonus.lbl.textContent     = 'Speed bonus';

  function updateInfo() {
    if (!selectedShip) { infoBox.style.display = 'none'; return; }
    infoBox.style.display = '';
    const planet  = getPlanetById(gamedata, selectedShip.pId);
    const bp      = selectedShip.blueprint;
    const emitter = emitterMap.get(bp.emitterType);
    const reactor = reactorMap.get(bp.reactorType);
    const cfg     = (emitter && reactor) ? calcShipConfig(bp, emitter, reactor) : null;
    const tankCap = cfg?.fuelCapacity ?? selectedShip.fuelCapacity ?? 0;
    infoRows.location.val.textContent  = planet?.name ?? `ID ${selectedShip.pId}`;
    infoRows.fuel.val.textContent      = `${(selectedShip.fuel ?? 0).toLocaleString()} / ${tankCap.toLocaleString()}`;
    const effectiveCap = Math.round((bp.cargoCapacity ?? 0) * (1 + flightPerks.cargoCapPct / 100));
    infoRows.cargo.val.textContent     = `${Math.round(selectedCargoWeight).toLocaleString()} / ${effectiveCap.toLocaleString()} t`;
    infoRows.condition.val.textContent = `${Math.round((selectedShip.condition ?? 1) * 100)}%`;
    const totalBonusPct = Math.round((totalSpeedMult - 1) * 100);
    infoRows.bonus.val.textContent = totalBonusPct !== 0 ? `+${totalBonusPct}%` : 'None';
  }

  panel.appendChild(infoBox);

  // ── Destination search ─────────────────────────────────────────────────────
  const destLabel = mkLabel('Destination', 'margin-bottom:4px;');
  panel.appendChild(destLabel);

  const destWrap = document.createElement('div');
  destWrap.style.cssText = 'position:relative;margin-bottom:8px;';

  const destInput = document.createElement('input');
  destInput.type = 'text';
  destInput.placeholder = 'Search planet\u2026';
  destInput.style.cssText = 'width:100%;background:#0a0a18;border:1px solid #2a2a4a;border-radius:4px;color:#c0c0da;font-size:11px;padding:5px 8px;font-family:inherit;box-sizing:border-box;';

  const destDropdown = document.createElement('div');
  destDropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#0d0d20;border:1px solid #2a2a4a;border-radius:4px;max-height:180px;overflow-y:auto;z-index:10;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.6);';

  let selectedDestPlanet = null;

  destInput.addEventListener('input', () => {
    const q = destInput.value.trim().toLowerCase();
    destDropdown.innerHTML = '';
    selectedDestPlanet = null;
    recalc();
    if (!q) { destDropdown.style.display = 'none'; return; }

    const matches = allPlanets.filter(p => p.name.toLowerCase().includes(q)).slice(0, 25);
    if (!matches.length) { destDropdown.style.display = 'none'; return; }

    for (const planet of matches) {
      const opt = document.createElement('div');
      opt.style.cssText = 'padding:4px 8px;font-size:11px;color:#c0c0da;cursor:pointer;';
      opt.textContent = planet.name;
      opt.addEventListener('mouseenter', () => { opt.style.background = '#111128'; });
      opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
      opt.addEventListener('mousedown', e => e.preventDefault());
      opt.addEventListener('click', () => {
        destInput.value = planet.name;
        selectedDestPlanet = planet;
        destDropdown.style.display = 'none';
        recalc();
      });
      destDropdown.appendChild(opt);
    }
    destDropdown.style.display = '';
  });
  destInput.addEventListener('blur', () => { destDropdown.style.display = 'none'; });

  destWrap.appendChild(destInput);
  destWrap.appendChild(destDropdown);
  panel.appendChild(destWrap);
  panel.appendChild(mkSep());

  // ── Results ────────────────────────────────────────────────────────────────
  const resultsBox = document.createElement('div');
  resultsBox.style.cssText = 'display:none;';

  // "Best Flight" header
  const bestHeader = mkLabel('Best Flight', 'margin-bottom:6px;');
  resultsBox.appendChild(bestHeader);

  // Slider visual
  const sliderBlock = document.createElement('div');
  sliderBlock.style.cssText = 'margin-bottom:8px;';

  const sliderLabelRow = document.createElement('div');
  sliderLabelRow.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;';
  const sliderEffLabel = document.createElement('span'); sliderEffLabel.style.color = '#6b6b8a'; sliderEffLabel.textContent = 'Efficiency';
  const sliderEffVal   = document.createElement('span'); sliderEffVal.style.cssText = 'color:#c0c0da;font-weight:600;';
  const sliderPowLabel = document.createElement('span'); sliderPowLabel.style.color = '#6b6b8a'; sliderPowLabel.textContent = 'Power';
  const sliderPowVal   = document.createElement('span'); sliderPowVal.style.cssText = 'color:#c0c0da;font-weight:600;';
  sliderLabelRow.appendChild(sliderEffLabel);
  sliderLabelRow.appendChild(sliderEffVal);
  sliderLabelRow.appendChild(sliderPowLabel);
  sliderLabelRow.appendChild(sliderPowVal);

  const sliderTrack = document.createElement('div');
  sliderTrack.style.cssText = 'position:relative;height:6px;background:#1a1a30;border-radius:3px;overflow:visible;';

  const sliderFill  = document.createElement('div');
  sliderFill.style.cssText = 'position:absolute;top:0;left:0;height:100%;border-radius:3px;transition:width .15s;background:#6d28d9;';

  const sliderThumb = document.createElement('div');
  sliderThumb.style.cssText = 'position:absolute;top:50%;width:10px;height:10px;border-radius:50%;background:#6d28d9;transform:translate(-50%,-50%);transition:left .15s;border:2px solid #0a0a18;';

  const sliderEndLabels = document.createElement('div');
  sliderEndLabels.style.cssText = 'display:flex;justify-content:space-between;font-size:9px;color:#3a3a5a;margin-top:3px;';
  sliderEndLabels.innerHTML = '<span>Eff ◀</span><span>▶ Pwr</span>';

  sliderTrack.appendChild(sliderFill);
  sliderTrack.appendChild(sliderThumb);
  sliderBlock.appendChild(sliderLabelRow);
  sliderBlock.appendChild(sliderTrack);
  sliderBlock.appendChild(sliderEndLabels);
  resultsBox.appendChild(sliderBlock);

  // Stat rows: distance, time, total cost, cost/ton, fuel, durability
  const resultRows = {};
  for (const key of ['distance','time','totalCost','costPerTon','fuel','durability']) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;padding:1px 0;';
    const lbl = document.createElement('span'); lbl.style.color = '#6b6b8a';
    const val = document.createElement('span'); val.style.cssText = 'color:#c0c0da;text-align:right;cursor:default;';
    row.appendChild(lbl); row.appendChild(val);
    resultsBox.appendChild(row);
    resultRows[key] = { lbl, val };
  }
  resultRows.distance.lbl.textContent   = 'Distance';
  resultRows.time.lbl.textContent       = 'Travel time';
  resultRows.totalCost.lbl.textContent  = 'Total cost';
  resultRows.costPerTon.lbl.textContent = 'Cost per ton';
  resultRows.fuel.lbl.textContent       = 'Fuel cost';
  resultRows.durability.lbl.textContent = 'Repair cost';

  const fuelWarning = document.createElement('div');
  fuelWarning.style.cssText = `color:${COL_CRIT};font-size:11px;padding:4px 0;display:none;font-weight:600;`;
  fuelWarning.textContent = '⚠ Insufficient fuel for this journey';

  panel.appendChild(resultsBox);
  panel.appendChild(fuelWarning);

  function recalc() {
    if (!selectedShip || !selectedDestPlanet) { resultsBox.style.display = 'none'; fuelWarning.style.display = 'none'; return; }

    const srcPlanet = getPlanetById(gamedata, selectedShip.pId);
    if (!srcPlanet) { resultsBox.style.display = 'none'; return; }

    // Planet-level distance; raw coords are in units of 1/45 ly
    const dx   = srcPlanet.x - selectedDestPlanet.x;
    const dy   = srcPlanet.y - selectedDestPlanet.y;
    const dist = Math.sqrt(dx * dx + dy * dy) / 45;

    const bp      = selectedShip.blueprint;
    const emitter = emitterMap.get(bp.emitterType);
    const reactor = reactorMap.get(bp.reactorType);
    if (!emitter || !reactor) { resultsBox.style.display = 'none'; return; }

    const cfg             = calcShipConfig(selectedShip.blueprint, emitter, reactor);
    const { weightEmpty } = cfg;
    const repairKitsTotal = weightEmpty / 10;
    const fuelPrice       = effectivePrice(reactor.fuelId);
    const repairKitPrice  = effectivePrice(REPAIR_KIT_MAT_ID);
    const fuelMat         = matMap.get(reactor.fuelId);
    const effectiveCargo  = selectedShip.blueprint.cargoCapacity * (1 + flightPerks.cargoCapPct / 100);

    const flightOpts = { fuelSavingMult, degradationMult, fuelPrice, repairKitPrice, repairKitsTotal, effectiveCargo };

    console.group('[GT Flight] recalc debug');
    console.log('Blueprint:', JSON.parse(JSON.stringify(selectedShip.blueprint)));
    console.log('Emitter:', emitter);
    console.log('Reactor:', reactor);
    console.log('Derived config:', cfg);
    console.log('Distance (ly):', dist.toFixed(3));
    console.log('Cargo weight (t):', selectedCargoWeight, '| effectiveCargo:', effectiveCargo);
    console.log('totalSpeedMult:', totalSpeedMult, '| startBonus:', startBonus, '| guildSpeedBonus:', guildSpeedBonus, '| perkSpeedMult:', perkSpeedMult);
    console.log('fuelPrice:', fuelPrice, '| fuelId:', reactor.fuelId, '| repairKitPrice:', repairKitPrice, '| repairKitsTotal:', repairKitsTotal);
    console.log('flightPerks:', flightPerks);
    console.groupEnd();

    // Find pf that minimises (fuelCost + repairCost) × time / cargo
    const optPF = findOptimalFlightPF(dist, selectedShip, selectedCargoWeight, emitter, reactor, totalSpeedMult, flightOpts);
    console.log('[GT Flight] optPF:', optPF.toFixed(2));

    const flightResult = calcFlight(
      dist, selectedShip, selectedCargoWeight, emitter, reactor, totalSpeedMult, optPF, flightOpts
    );
    const { timeHours, fuelUsed, weightRatio, powerFraction, condWear, tankCapacity } = flightResult;
    console.log('[GT Flight] result:', { timeHours: timeHours.toFixed(3), fuelUsed: fuelUsed.toFixed(2), weightRatio: weightRatio.toFixed(3), powerFraction: powerFraction.toFixed(2), condWear: condWear.toFixed(4), tankCapacity });

    const fuelCost       = fuelUsed * fuelPrice;
    const repairKitsUsed = repairKitsTotal * condWear;
    const repairCost     = repairKitsUsed * repairKitPrice;
    const totalCost      = fuelCost + repairCost;
    const hasFuel        = (selectedShip.fuel ?? 0) >= Math.ceil(fuelUsed);
    const condWearPct    = (condWear * 100).toFixed(1);
    const costPerTon     = effectiveCargo > 0 ? totalCost / effectiveCargo : 0;

    // Slider: efficiency = 120 − power, sliderPos = (power−20)/80
    const powerPct  = Math.round(powerFraction * 100);
    const effPct    = 120 - powerPct;
    const sliderPos = Math.max(0, Math.min(1, (powerPct - 20) / 80));
    sliderEffVal.textContent = `${effPct}%`;
    sliderPowVal.textContent = `${powerPct}%`;
    sliderFill.style.width   = `${sliderPos * 100}%`;
    sliderThumb.style.left   = `${sliderPos * 100}%`;

    resultRows.distance.val.textContent   = `${dist.toFixed(1)} ly`;
    resultRows.time.val.textContent       = fmtFlightTime(timeHours);
    resultRows.totalCost.val.textContent  = totalCost > 0 ? fmtCr(totalCost) : '—';
    resultRows.costPerTon.val.textContent = costPerTon > 0 ? `$${costPerTon.toFixed(2)}` : '—';

    // Fuel cost row
    resultRows.fuel.val.style.color   = hasFuel ? '#c0c0da' : COL_CRIT;
    resultRows.fuel.val.textContent   = fuelCost > 0 ? fmtCr(fuelCost) : '—';
    attachTooltip(resultRows.fuel.val, tip => {
      if (fuelPrice <= 0) return false;
      tip.appendChild(mkTipTitle('Fuel breakdown'));
      tip.appendChild(mkIconLine(fuelMat?.name ?? 'Fuel', `×${Math.ceil(fuelUsed).toLocaleString()}`, fmtCr(fuelCost)));
      const tankLine = document.createElement('div');
      tankLine.style.cssText = 'font-size:10px;color:#6b6b8a;margin-top:4px;';
      tankLine.textContent = `Tank: ${(selectedShip.fuel ?? 0).toLocaleString()} / ${tankCapacity.toLocaleString()} ${fuelMat?.name ?? ''}${hasFuel ? '' : ' ⚠ insufficient'}`;
      tip.appendChild(tankLine);
    }, true);

    // Repair cost row
    resultRows.durability.val.textContent = repairCost > 0 ? fmtCr(repairCost) : '—';
    attachTooltip(resultRows.durability.val, tip => {
      if (repairKitPrice <= 0) return false;
      tip.appendChild(mkTipTitle('Repair breakdown'));
      tip.appendChild(mkIconLine('Ship Repair Kit', `×${Math.ceil(repairKitsUsed).toLocaleString()}`, fmtCr(repairCost)));
      const condLine = document.createElement('div');
      condLine.style.cssText = 'font-size:10px;color:#6b6b8a;margin-top:4px;';
      condLine.textContent = `Condition loss: ${condWearPct}%`;
      tip.appendChild(condLine);
    }, true);

    fuelWarning.style.display = hasFuel ? 'none' : '';
    resultsBox.style.display  = '';
  }

  document.body.appendChild(panel);
  _flightOpen = true;

  // Ensure price and guild data are loaded, then re-run recalc.
  // avg prices cover all materials (fuel, repair kits, etc.).
  const pendingFetches = [];
  if (!_priceMap)    pendingFetches.push(fetchMatPrices());
  if (!_avgPriceMap) pendingFetches.push(fetchAvgPrices());
  if (!_guildData)   pendingFetches.push(fetchGuildData());
  if (pendingFetches.length) {
    Promise.all(pendingFetches).then(() => {
      // Update guild-derived values now that data has arrived
      const latestFCLevel = (_guildData?.projects ?? []).find(p => p.type === 3)?.level ?? 0;
      if (latestFCLevel !== flightCenterLevel) {
        flightCenterLevel = latestFCLevel;
        guildSpeedBonus   = 1 + flightCenterLevel * 0.03;
        totalSpeedMult    = startBonus * guildSpeedBonus * perkSpeedMult;
        recalc();
      }
    }).catch(() => {});
  }
}

function toggleFlightPanel() {
  if (_flightOpen) {
    document.getElementById(GT_FLIGHT_ID)?.remove();
    _flightOpen = false;
  } else openFlightPanel();
}

let _cashOpen = false;

function closeAllPanels() {
  document.getElementById(GT_DETAIL_ID)?.remove();        _detailBaseId    = null;
  document.getElementById(GT_SETTINGS_ID)?.remove();      _settingsOpen    = false;
  document.getElementById(GT_CASH_ID)?.remove();          _cashOpen        = false;
  document.getElementById(GT_SUMMARY_ID)?.remove();       _summaryOpen     = false;
  document.getElementById(GT_FLIGHT_ID)?.remove();        _flightOpen = false;
  document.getElementById(GT_WISHLIST_ALL_ID)?.remove();  _wishlistAllOpen = false;
}

// ── Panel Wishlist ─────────────────────────────────────────────────────────────

async function _showImportWishlistPicker(panel) {
  // Remove existing picker if open (toggle)
  const existing = panel.querySelector('[data-wl-picker]');
  if (existing) { existing.remove(); return; }

  const picker = document.createElement('div');
  picker.setAttribute('data-wl-picker', '1');
  picker.style.cssText = 'margin:0 10px 6px;background:#0a0a18;border:1px solid #2a2a4a;border-radius:6px;overflow:hidden;';

  const loading = document.createElement('div');
  loading.style.cssText = 'color:#6b6b8a;font-size:11px;padding:8px 10px;font-style:italic;';
  loading.textContent = 'Loading\u2026';
  picker.appendChild(loading);

  // Insert picker right after the header (index 0)
  panel.children[0].after(picker);

  const lists = await requestGTLocalAPI('getWishlists');
  loading.remove();

  const arr = lists?.wishlists ?? (Array.isArray(lists) ? lists : null);
  if (!arr?.length) {
    const none = document.createElement('div');
    none.style.cssText = 'color:#6b6b8a;font-size:11px;padding:8px 10px;';
    none.textContent = 'No wishlists found.';
    picker.appendChild(none);
    return;
  }

  // Filter out client-only empty wishlists and planet wishlists with no mats
  const usable = arr.filter(w => !w.isClientOnly && w.mats?.length);

  if (!usable.length) {
    const none = document.createElement('div');
    none.style.cssText = 'color:#6b6b8a;font-size:11px;padding:8px 10px;';
    none.textContent = 'No wishlists with items found.';
    picker.appendChild(none);
    return;
  }

  const matMap = new Map(((_loadedHeaderGamedata?.materials) ?? []).map(m => [m.id, m.name ?? `mat${m.id}`]));

  for (const wl of usable) {
    const label = wl.title ?? `Wishlist #${wl.id}`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 10px;cursor:pointer;border-bottom:1px solid #12122a;font-size:11px;';
    row.addEventListener('mouseenter', () => { row.style.background = '#111128'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });

    const nameLbl = document.createElement('span');
    nameLbl.style.cssText = 'color:#c0c0da;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameLbl.textContent = label;

    const countLbl = document.createElement('span');
    countLbl.style.cssText = 'color:#6b6b8a;font-size:10px;margin-left:6px;white-space:nowrap;';
    countLbl.textContent = `${wl.mats.length} items`;

    row.appendChild(nameLbl);
    row.appendChild(countLbl);

    row.addEventListener('click', async () => {
      picker.remove();
      const key = `wl_${wl.id}`;
      const data = await loadPanelWishlist();
      if (!data[key]) data[key] = { baseName: label, items: [] };
      for (const m of wl.mats) {
        const id   = Number(m.id ?? m.matId);
        const am   = Number(m.am ?? m.amount ?? 0);
        const name = matMap.get(id) ?? `mat${id}`;
        const existing2 = data[key].items.find(i => i.id === id);
        if (existing2) existing2.am += am;
        else data[key].items.push({ id, name, am });
      }
      savePanelWishlist(data);
      _renderPanelWishlistContent(panel, data);
    });

    picker.appendChild(row);
  }
}

function _renderPanelWishlistContent(panel, data) {
  // Remove existing content below header
  const header = panel.querySelector('[data-pwh]');
  while (panel.lastChild !== header) panel.removeChild(panel.lastChild);

  const keys = Object.keys(data);

  if (!keys.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:#6b6b8a;font-style:italic;font-size:11px;padding:6px 12px 10px;';
    empty.textContent = 'No items \u2014 use Wishlist All or + to import.';
    panel.appendChild(empty);
    _updatePanelWishlistBtn();
    return;
  }

  // Clear all button
  const clearAllBtn = document.createElement('div');
  clearAllBtn.style.cssText = 'margin:0 10px 4px;padding:4px 8px;background:#12122a;border:1px solid #1a1a30;border-radius:4px;color:#6b6b8a;font-size:10px;text-align:center;cursor:pointer;';
  clearAllBtn.textContent = 'Clear All';
  clearAllBtn.addEventListener('mouseenter', () => { clearAllBtn.style.color = '#ef4444'; clearAllBtn.style.borderColor = '#ef4444'; });
  clearAllBtn.addEventListener('mouseleave', () => { clearAllBtn.style.color = '#6b6b8a'; clearAllBtn.style.borderColor = '#1a1a30'; });
  clearAllBtn.addEventListener('click', () => { clearPanelAll(); _renderPanelWishlistContent(panel, {}); });
  panel.appendChild(clearAllBtn);

  for (const key of keys) {
    const entry = data[key];

    // Base header
    const baseRow = document.createElement('div');
    baseRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 12px 3px;position:relative;';
    const baseLbl = mkLabel(entry.baseName);
    const clearBaseBtn = document.createElement('span');
    clearBaseBtn.style.cssText = 'color:#6b6b8a;font-size:11px;cursor:pointer;opacity:0;transition:opacity 0.15s;';
    clearBaseBtn.textContent = '×';
    clearBaseBtn.title = 'Clear base';
    baseRow.addEventListener('mouseenter', () => { clearBaseBtn.style.opacity = '1'; });
    baseRow.addEventListener('mouseleave', () => { clearBaseBtn.style.opacity = '0'; });
    clearBaseBtn.addEventListener('click', async () => {
      await clearPanelBase(key);
      const fresh = await loadPanelWishlist();
      _renderPanelWishlistContent(panel, fresh);
    });
    baseRow.appendChild(baseLbl);
    baseRow.appendChild(clearBaseBtn);
    panel.appendChild(baseRow);

    // Items
    for (const item of entry.items) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px 12px;position:relative;';
      row.addEventListener('mouseenter', () => { row.style.background = '#111128'; clearBtn.style.opacity = '1'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; clearBtn.style.opacity = '0'; });

      const ic = makeIcon(item.name, 14);
      if (ic) row.appendChild(ic);

      const nameLbl = document.createElement('span');
      nameLbl.style.cssText = 'flex:1;font-size:11px;color:#c0c0da;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameLbl.textContent = item.name;

      const amtLbl = document.createElement('span');
      amtLbl.style.cssText = 'font-size:11px;color:#9090b0;white-space:nowrap;';
      amtLbl.textContent = `x${item.am.toLocaleString()}`;

      const clearBtn = document.createElement('span');
      clearBtn.style.cssText = 'color:#6b6b8a;font-size:11px;cursor:pointer;opacity:0;transition:opacity 0.15s;margin-left:2px;flex-shrink:0;';
      clearBtn.textContent = '×';
      clearBtn.title = 'Remove';
      clearBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await clearPanelItem(key, item.id);
        const fresh = await loadPanelWishlist();
        _renderPanelWishlistContent(panel, fresh);
      });

      row.appendChild(nameLbl);
      row.appendChild(amtLbl);
      row.appendChild(clearBtn);
      panel.appendChild(row);
    }

    // Divider
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:#12122a;margin:4px 10px;';
    panel.appendChild(sep);
  }

  _updatePanelWishlistBtn();
}

function _updatePanelWishlistBtn() {
  const btn = document.getElementById(GT_PANEL_WISHLIST_BTN_ID);
  if (!btn) return;
  loadPanelWishlist().then(data => {
    const count = Object.values(data).reduce((s, b) => s + b.items.length, 0);
    btn.style.display = _panelWishlistOpen ? 'none' : '';
    const textEl = btn.querySelector('span');
    if (textEl) textEl.style.color = count > 0 ? '#7c3aed' : '#6b6b8a';
  });
}

async function openPanelWishlist() {
  if (_panelWishlistOpen) return;
  _panelWishlistOpen = true;

  const data = await loadPanelWishlist();
  const savedPos = await new Promise(r => chrome.storage.local.get(['gtPanelWishlistPos'], ({ gtPanelWishlistPos }) => r(gtPanelWishlistPos ?? null)));

  const panel = document.createElement('div');
  panel.id = GT_PANEL_WISHLIST_ID;
  panel.style.cssText = [
    'position:fixed',
    savedPos ? `left:${savedPos.x}px;top:${savedPos.y}px` : 'right:270px;top:80px',
    'width:260px',
    'max-height:70vh',
    'overflow-y:auto',
    'background:#0d0d20',
    'border:1px solid #1a1a38',
    'border-radius:8px',
    'font-family:system-ui,sans-serif',
    'font-size:12px',
    'color:#d8d8f0',
    'box-shadow:0 4px 24px rgba(0,0,0,0.7)',
    'z-index:2147483641',
    'user-select:none',
  ].join(';');

  // Header (drag handle)
  const hdr = document.createElement('div');
  hdr.setAttribute('data-pwh', '1');
  hdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #1a1a38;cursor:grab;background:#0a0a18;border-radius:8px 8px 0 0;flex-shrink:0;';

  const titleLbl = document.createElement('span');
  titleLbl.style.cssText = 'flex:1;font-size:12px;font-weight:600;color:#d8d8f0;';
  titleLbl.textContent = 'Wishlist Panel';

  const importHdrBtn = document.createElement('span');
  importHdrBtn.style.cssText = 'cursor:pointer;font-size:16px;color:#6b6b8a;padding:0 2px;line-height:1;font-weight:400;';
  importHdrBtn.textContent = '+';
  importHdrBtn.title = 'Import wishlist';
  importHdrBtn.addEventListener('click', (e) => { e.stopPropagation(); _showImportWishlistPicker(panel); });
  importHdrBtn.addEventListener('mouseenter', () => { importHdrBtn.style.color = '#a78bfa'; });
  importHdrBtn.addEventListener('mouseleave', () => { importHdrBtn.style.color = '#6b6b8a'; });

  const closeBtn = document.createElement('span');
  closeBtn.style.cssText = 'cursor:pointer;font-size:14px;color:#6b6b8a;padding:0 2px;line-height:1;';
  closeBtn.textContent = '\u00d7';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanelWishlist(); });

  hdr.appendChild(titleLbl);
  hdr.appendChild(importHdrBtn);
  hdr.appendChild(closeBtn);
  panel.appendChild(hdr);

  // Drag logic
  let dragOffX = 0, dragOffY = 0;
  function onDragMove(e) {
    panel.style.left  = (e.clientX - dragOffX) + 'px';
    panel.style.top   = (e.clientY - dragOffY) + 'px';
    panel.style.right = 'auto';
  }
  function onDragUp() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup',   onDragUp);
    hdr.style.cursor = 'grab';
    chrome.storage.local.set({ gtPanelWishlistPos: { x: panel.offsetLeft, y: panel.offsetTop } });
  }
  hdr.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn || e.target === importHdrBtn) return;
    dragOffX = e.clientX - panel.getBoundingClientRect().left;
    dragOffY = e.clientY - panel.getBoundingClientRect().top;
    hdr.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragUp);
  });

  document.body.appendChild(panel);
  _panelWishlistOpen = true;
  _renderPanelWishlistContent(panel, data);
  _updatePanelWishlistBtn();
}

function closePanelWishlist() {
  document.getElementById(GT_PANEL_WISHLIST_ID)?.remove();
  _panelWishlistOpen = false;
  _updatePanelWishlistBtn();
}

function togglePanelWishlist() {
  if (_panelWishlistOpen) closePanelWishlist();
  else openPanelWishlist();
}

async function openCashPanel() {
  closeAllPanels();
  const panel = mkPanelBase(GT_CASH_ID, true);
  panel.appendChild(mkPanelTitle('Assets'));

  const loading = document.createElement('div');
  loading.style.cssText = 'color:#6b6b8a;font-style:italic;';
  loading.textContent = 'Loading\u2026';
  panel.appendChild(loading);
  document.body.appendChild(panel);
  _cashOpen = true;

  const [company] = await Promise.all([fetchCompanyData(), fetchMatPrices()]);
  loading.remove();

  // Cash balance — game API returns cents, divide by 100
  const cashRaw = company?.cash ?? company?.credits ?? company?.balance ?? company?.money ?? null;
  const cashNum = cashRaw !== null ? cashRaw / 100 : null;
  if (cashNum !== null) {
    panel.appendChild(mkRow('Cash', fmtCr(cashNum), COL_OK));
    panel.appendChild(mkSep());
  }

  // Base inventory value — collapsible header like Ship Cargo
  const bases = sortBases(_loadedHeaderBases ?? []);
  let totalInv = 0;
  if (bases.length && _priceMap) {
    const baseInvData = [];
    if (_loadedHeaderGamedata) {
      for (const base of bases) {
        let val = 0;
        const breakdown = [];
        const { outputs } = calcBaseNeeds(base, _loadedHeaderGamedata);
        const warehouseAmts = new Map((base.warehouse?.mats ?? []).map(m => [Number(m.id), m.am ?? 0]));
        for (const out of outputs) {
          const qty     = warehouseAmts.get(Number(out.matId)) ?? 0;
          const price   = effectivePrice(out.matId);
          const lineVal = qty * price;
          val += lineVal;
          if (qty > 0 && price > 0) breakdown.push({ name: out.name, qty, price, lineVal });
        }
        totalInv += val;
        baseInvData.push({ base, val, breakdown });
      }
    }

    if (totalInv > 0 || baseInvData.length) {
      let invExpanded = false;
      const invHdrRow = document.createElement('div');
      invHdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 0;cursor:pointer;';
      const invHdrLeft = document.createElement('div');
      invHdrLeft.style.cssText = 'display:flex;align-items:center;gap:5px;';
      const invArrow = document.createElement('span');
      invArrow.style.cssText = 'color:#6b6b8a;font-size:10px;';
      invArrow.textContent = '\u25be';
      const invHdrLbl = document.createElement('span');
      invHdrLbl.style.color = '#c0c0da';
      invHdrLbl.textContent = 'Base Inventory';
      invHdrLeft.appendChild(invArrow); invHdrLeft.appendChild(invHdrLbl);
      const invHdrVal = document.createElement('span');
      invHdrVal.style.cssText = 'color:#9090b0;font-size:11px;';
      invHdrVal.textContent = fmtCr(totalInv);
      invHdrRow.appendChild(invHdrLeft); invHdrRow.appendChild(invHdrVal);

      const invBaseList = document.createElement('div');
      invBaseList.style.display = 'none';

      for (const { base, val, breakdown } of baseInvData) {
        const baseRow = document.createElement('div');
        baseRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 0 2px 12px;cursor:default;border-bottom:1px solid #12122a;';
        const bLbl = document.createElement('span');
        bLbl.style.cssText = 'color:#9090b0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        bLbl.textContent = base.name;
        const bVal = document.createElement('span');
        bVal.style.cssText = 'color:#9090b0;font-size:11px;white-space:nowrap;';
        bVal.textContent = fmtCr(val);
        baseRow.appendChild(bLbl); baseRow.appendChild(bVal);
        if (breakdown.length) {
          attachTooltip(baseRow, tip => {
            for (const item of breakdown) {
              tip.appendChild(mkIconLine(item.name, `${item.name} x${item.qty.toLocaleString()}`, `@ ${fmtCr(item.price)} ($${Math.round(item.lineVal).toLocaleString()})`));
            }
          }, true);
        }
        invBaseList.appendChild(baseRow);
      }

      invHdrRow.addEventListener('click', () => {
        invExpanded = !invExpanded;
        invBaseList.style.display = invExpanded ? 'block' : 'none';
        invArrow.textContent = invExpanded ? '\u25b4' : '\u25be';
      });

      panel.appendChild(invHdrRow);
      panel.appendChild(invBaseList);
      panel.appendChild(mkSep());
    }
  }

  // Exchange listings (active sell orders)
  let exchangeListingsVal = 0;
  const listings = company?.exchangeListings ?? company?.listings ?? company?.exchange?.listings ?? [];
  if (listings.length && _priceMap) {
    const exTitle = mkLabel('Exchange Listings', 'margin:4px 0 4px;');
    panel.appendChild(exTitle);
    for (const l of listings) {
      const matId = Number(l.matId ?? l.id);
      const qty   = l.qty ?? l.amount ?? l.am ?? 0;
      const val   = qty * effectivePrice(matId);
      exchangeListingsVal += val;
      const name  = l.matName ?? l.name ?? `mat${matId}`;
      panel.appendChild(mkRow(name, qty.toLocaleString() + ' × ' + fmtCr(effectivePrice(matId))));
    }
    panel.appendChild(mkRow('Listings total', fmtCr(exchangeListingsVal), COL_OK));
    panel.appendChild(mkSep());
  }

  // Exchange warehouse — all items
  let exchangeWarehouseVal = 0;
  const warehouseId = company?.exWhId;
  const exchWarehouse = warehouseId ? await requestGTLocalAPI('getWarehouse', { warehouseId }) : null;
  const exchWarehouseMats = exchWarehouse?.mats ?? [];
  if (exchWarehouseMats.length && _priceMap) {
    const valued = exchWarehouseMats
      .map(m => {
        const matId   = Number(m.id);
        const qty     = m.am ?? 0;
        const price   = effectivePrice(matId);
        const lineVal = qty * price;
        const name    = _loadedHeaderGamedata?.materials?.find(mat => mat.id === matId)?.name ?? `mat${matId}`;
        return { matId, qty, price, lineVal, name };
      })
      .filter(m => m.qty > 0)
      .sort((a, b) => b.lineVal - a.lineVal);

    if (valued.length) {
      valued.forEach(m => { exchangeWarehouseVal += m.lineVal; });

      const row = mkRow('Exchange Warehouse', fmtCr(exchangeWarehouseVal));
      row.style.cursor = 'default';
      attachTooltip(row, tip => {
        for (const m of valued) {
          const valStr = m.price > 0 ? `@ ${fmtCr(m.price)} ($${Math.round(m.lineVal).toLocaleString()})` : null;
          tip.appendChild(mkIconLine(m.name, `${m.name} x${m.qty.toLocaleString()}`, valStr));
        }
      }, true);
      panel.appendChild(row);
      panel.appendChild(mkSep());
    }
  }

  // Ship cargo
  let shipCargoVal = 0;
  const ships = company?.ships ?? [];
  if (ships.length && _priceMap) {
    // Fetch all ship warehouses in parallel
    const shipData = (await Promise.all(
      ships.map(async s => {
        const wh = s.warehouseId ? await requestGTLocalAPI('getWarehouse', { warehouseId: s.warehouseId }) : null;
        const mats = (wh?.mats ?? [])
          .map(m => {
            const matId   = Number(m.id);
            const qty     = m.am ?? 0;
            const price   = effectivePrice(matId);
            const lineVal = qty * price;
            const name    = _loadedHeaderGamedata?.materials?.find(mat => mat.id === matId)?.name ?? `mat${matId}`;
            return { matId, qty, price, lineVal, name };
          })
          .filter(m => m.qty > 0)
          .sort((a, b) => b.lineVal - a.lineVal);
        const total = mats.reduce((s, m) => s + m.lineVal, 0);
        return { ship: s, mats, total };
      })
    )).filter(d => d.mats.length > 0);

    if (shipData.length) {
      shipCargoVal = shipData.reduce((s, d) => s + d.total, 0);

      // Header row — clickable to expand/collapse
      let expanded = false;
      const hdrRow = document.createElement('div');
      hdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 0;cursor:pointer;';
      const hdrLeft = document.createElement('div');
      hdrLeft.style.cssText = 'display:flex;align-items:center;gap:5px;';
      const arrow = document.createElement('span');
      arrow.style.cssText = 'color:#6b6b8a;font-size:10px;';
      arrow.textContent = '\u25be';
      const hdrLbl = document.createElement('span');
      hdrLbl.style.color = '#c0c0da';
      hdrLbl.textContent = 'Ship Cargo';
      hdrLeft.appendChild(arrow); hdrLeft.appendChild(hdrLbl);
      const hdrVal = document.createElement('span');
      hdrVal.style.cssText = 'color:#9090b0;font-size:11px;';
      hdrVal.textContent = fmtCr(shipCargoVal);
      hdrRow.appendChild(hdrLeft); hdrRow.appendChild(hdrVal);

      // Ship rows container (hidden by default)
      const shipList = document.createElement('div');
      shipList.style.display = 'none';

      for (const { ship, mats, total: shipTotal } of shipData) {
        const shipRow = document.createElement('div');
        shipRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 0 2px 12px;cursor:default;border-bottom:1px solid #12122a;';
        const sLbl = document.createElement('span');
        sLbl.style.cssText = 'color:#9090b0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        sLbl.textContent = ship.name;
        const sVal = document.createElement('span');
        sVal.style.cssText = 'color:#9090b0;font-size:11px;white-space:nowrap;';
        sVal.textContent = fmtCr(shipTotal);
        shipRow.appendChild(sLbl); shipRow.appendChild(sVal);

        // Hover tooltip: cargo breakdown
        attachTooltip(shipRow, tip => {
          for (const m of mats) {
            const valStr = m.price > 0 ? `@ ${fmtCr(m.price)} ($${Math.round(m.lineVal).toLocaleString()})` : null;
            tip.appendChild(mkIconLine(m.name, `${m.name} x${m.qty.toLocaleString()}`, valStr));
          }
        }, true);
        shipList.appendChild(shipRow);
      }

      hdrRow.addEventListener('click', () => {
        expanded = !expanded;
        shipList.style.display = expanded ? 'block' : 'none';
        arrow.textContent = expanded ? '\u25b4' : '\u25be';
      });

      panel.appendChild(hdrRow);
      panel.appendChild(shipList);
      panel.appendChild(mkSep());
    }
  }

  const cashVal = typeof cashNum === 'number' ? cashNum : 0;
  const total   = cashVal + totalInv + exchangeListingsVal + exchangeWarehouseVal + shipCargoVal;
  if (total > 0) {
    panel.appendChild(mkRow('Total', fmtCr(total), '#d8d8f0'));
  }
  if (!_priceMap) {
    const note = document.createElement('div');
    note.style.cssText = 'color:#6b6b8a;font-size:10px;margin-top:6px;font-style:italic;';
    note.textContent = 'Inventory values need prices — enable costs in settings.';
    panel.appendChild(note);
  }
  if (!company && cashNum === null) {
    const err = document.createElement('div');
    err.style.cssText = 'color:#6b6b8a;font-style:italic;';
    err.textContent = 'No company data available.';
    panel.appendChild(err);
  }
}

function toggleCashPanel() {
  if (_cashOpen) { document.getElementById(GT_CASH_ID)?.remove(); _cashOpen = false; }
  else openCashPanel();
}

// ── Summary panel ─────────────────────────────────────────────────────────────

let _summaryOpen      = false;
let _summaryPerBase   = false;
let _summaryShowStock = false;
let _wishlistAllOpen  = false;

function buildSummaryContent(container, perBase) {
  container.innerHTML = '';
  if (!_loadedHeaderBases || !_loadedHeaderGamedata) return;

  const bases = sortBases(_loadedHeaderBases).filter(b => !_settings.hiddenBases.includes(String(b.id)));

  const attachTip = (el, buildFn) => {
    let tip = null;
    el.style.cursor = 'default';
    el.addEventListener('mouseenter', () => {
      tip = buildFn();
      if (tip) document.body.appendChild(tip);
    });
    el.addEventListener('mousemove', (e) => {
      if (!tip) return;
      const x = Math.max(8, e.clientX - tip.offsetWidth - 12);
      const y = Math.min(e.clientY + 12, window.innerHeight - tip.offsetHeight - 8);
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    el.addEventListener('mouseleave', () => { tip?.remove(); tip = null; });
  };

  const mkTipEl = () => {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;z-index:2147483647;background:#0d0d20;border:1px solid #2a2a4a;border-radius:6px;padding:8px 10px;font-size:11px;color:#b0b0cc;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.6);';
    return t;
  };

  const mkTipLine = (lbl, val, vc) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;justify-content:space-between;gap:16px;padding:1px 0;';
    const l = document.createElement('span'); l.style.color = '#6b6b8a'; l.textContent = lbl;
    const v = document.createElement('span'); v.style.cssText = `color:${vc};font-weight:600;`; v.textContent = val;
    d.appendChild(l); d.appendChild(v);
    return d;
  };

  const mkTipSep = () => {
    const s = document.createElement('div');
    s.style.cssText = 'border-top:1px solid #1a1a30;margin:4px 0 2px;';
    return s;
  };

  const mkSection = (label, parent) => {
    parent.appendChild(mkLabel(label, 'margin:8px 0 3px;'));
  };

  // Renders a single flow row: name | stock (bold) | qty/d | ±$/d
  const renderFlowRow = (name, matId, flow, inStock, parent) => {
    const isOut     = flow > 0;
    const unitPrice = _priceMap ? effectivePrice(matId) : 0;
    const dailyVal  = Math.abs(flow) * unitPrice;
    const valCol    = isOut ? COL_OK : COL_CRIT;

    const cols = _summaryShowStock ? '1fr auto auto auto' : '1fr auto auto';
    const row = document.createElement('div');
    row.style.cssText = `display:grid;grid-template-columns:${cols};gap:4px;align-items:center;padding:3px 0;border-bottom:1px solid #12122a;cursor:default;`;

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'color:#c0c0da;display:flex;align-items:center;gap:4px;min-width:0;';
    const ic = makeIcon(name);
    if (ic) nameSpan.appendChild(ic);
    const nt = document.createElement('span');
    nt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nt.textContent = name;
    nameSpan.appendChild(nt);

    const qtySpan = document.createElement('span');
    qtySpan.style.cssText = 'color:#6b6b8a;font-size:10px;white-space:nowrap;text-align:right;';
    qtySpan.textContent = Math.round(Math.abs(flow)).toLocaleString() + '/d';

    const valSpan = document.createElement('span');
    valSpan.style.cssText = `color:${valCol};font-size:10px;white-space:nowrap;text-align:right;`;
    valSpan.textContent = dailyVal > 0
      ? (isOut ? '+' : '\u2212') + fmtCr(dailyVal) + '/d'
      : '\u2014';

    row.appendChild(nameSpan);
    if (_summaryShowStock) {
      const stockSpan = document.createElement('span');
      stockSpan.style.cssText = 'color:#c0c0da;font-size:10px;font-weight:700;white-space:nowrap;text-align:right;';
      stockSpan.textContent = Math.round(inStock).toLocaleString();
      row.appendChild(stockSpan);
    }
    row.appendChild(qtySpan); row.appendChild(valSpan);

    // Tooltip — matches expanded panel style exactly
    let rowTip = null;
    row.addEventListener('mouseenter', () => {
      rowTip = document.createElement('div');
      rowTip.style.cssText = 'position:fixed;z-index:2147483647;background:#0d0d20;border:1px solid #2a2a4a;border-radius:5px;padding:6px 9px;font-size:11px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.6);';
      const tipRows = [
        ['Current stock', Math.round(inStock).toLocaleString(),                    '#c0c0da'],
        [isOut ? 'Net output /day' : 'Net input /day', Math.round(Math.abs(flow)).toLocaleString() + '/d', '#9090b0'],
      ];
      if (dailyVal > 0) tipRows.push([(isOut ? 'Income' : 'Cost') + ' /day', (isOut ? '+' : '\u2212') + fmtCr(dailyVal) + '/d', valCol]);
      for (const [lbl, val, vc] of tipRows) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;justify-content:space-between;gap:16px;padding:1px 0;';
        const l = document.createElement('span'); l.style.color = '#6b6b8a'; l.textContent = lbl;
        const v = document.createElement('span'); v.style.cssText = `color:${vc};font-weight:600;`; v.textContent = val;
        line.appendChild(l); line.appendChild(v);
        rowTip.appendChild(line);
      }
      document.body.appendChild(rowTip);
    });
    row.addEventListener('mousemove', (e) => {
      if (!rowTip) return;
      const x = Math.min(e.clientX + 12, window.innerWidth  - rowTip.offsetWidth  - 8);
      const y = Math.min(e.clientY + 12, window.innerHeight - rowTip.offsetHeight - 8);
      rowTip.style.left = x + 'px'; rowTip.style.top = y + 'px';
    });
    row.addEventListener('mouseleave', () => { rowTip?.remove(); rowTip = null; });

    parent.appendChild(row);
  };

  const mkNetProfitRow = (parent, dailyIncome, dailyCost, styleStr) => {
    const net    = dailyIncome - dailyCost;
    const netCol = net >= 0 ? COL_OK : COL_CRIT;
    const nr = document.createElement('div');
    nr.style.cssText = styleStr;
    const nl = document.createElement('span');
    nl.style.cssText = 'color:#6b6b8a;font-size:10px;';
    nl.textContent = 'Net profit';
    const nv = document.createElement('span');
    nv.style.cssText = `color:${netCol};font-size:11px;font-weight:700;`;
    nv.textContent = (net >= 0 ? '+' : '\u2212') + fmtCr(Math.abs(net)) + '/d';
    nr.appendChild(nl); nr.appendChild(nv);
    attachTip(nr, () => {
      const t = mkTipEl();
      if (dailyIncome > 0) t.appendChild(mkTipLine('Income',      '+' + fmtCr(dailyIncome) + '/d', COL_OK));
      if (dailyCost   > 0) t.appendChild(mkTipLine('Input costs', '\u2212' + fmtCr(dailyCost) + '/d', COL_CRIT));
      t.appendChild(mkTipSep());
      t.appendChild(mkTipLine('Net', (net >= 0 ? '+' : '\u2212') + fmtCr(Math.abs(net)) + '/d', netCol));
      return t;
    });
    parent.appendChild(nr);
  };

  // Build a per-material net flow map across all bases:
  //   flow = Σ(netDailyOutput) - Σ(dailyNeed for inputs/consumables)
  // Materials with flow > 0 → net outputs; flow < 0 → net inputs
  const buildFlowMap = (baseList) => {
    const flowMap = new Map(); // matId → { name, flow, inStock }
    for (const base of baseList) {
      const { inputs, consumables, outputs } = calcBaseNeeds(base, _loadedHeaderGamedata);
      for (const r of [...inputs, ...consumables]) {
        const ex = flowMap.get(r.matId);
        if (ex) { ex.flow -= r.dailyNeed; ex.inStock += r.inStock; }
        else flowMap.set(r.matId, { name: r.name, matId: r.matId, flow: -r.dailyNeed, inStock: r.inStock });
      }
      for (const r of outputs) {
        const netOut = r.netDailyOutput ?? r.dailyOutput;
        const ex = flowMap.get(r.matId);
        if (ex) { ex.flow += netOut; ex.inStock = Math.max(ex.inStock, r.inStock); }
        else flowMap.set(r.matId, { name: r.name, matId: r.matId, flow: netOut, inStock: r.inStock });
      }
    }
    return flowMap;
  };

  if (perBase) {
    // ── Per-base view — net flow per base ──
    for (const base of bases) {
      const hdr = document.createElement('div');
      hdr.style.cssText = 'color:#d1d5db;font-size:12px;font-weight:600;margin:10px 0 3px;padding-top:6px;border-top:1px solid #1e1e3a;';
      hdr.textContent = base.name;
      container.appendChild(hdr);

      const flowMap = buildFlowMap([base]);
      const netInputs  = [...flowMap.values()].filter(r => r.flow < -0.01).sort((a, b) => a.flow - b.flow);
      const netOutputs = [...flowMap.values()].filter(r => r.flow >  0.01).sort((a, b) => b.flow - a.flow);

      if (!netInputs.length && !netOutputs.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#6b6b8a;font-size:11px;font-style:italic;padding:2px 0;';
        empty.textContent = 'No active production';
        container.appendChild(empty);
        continue;
      }

      if (netInputs.length)  { mkSection('Net Inputs',  container); netInputs.forEach(r  => renderFlowRow(r.name, r.matId, r.flow, r.inStock, container)); }
      if (netOutputs.length) { mkSection('Net Outputs', container); netOutputs.forEach(r => renderFlowRow(r.name, r.matId, r.flow, r.inStock, container)); }

      if (_priceMap && (netInputs.length || netOutputs.length)) {
        const dailyIncome = netOutputs.reduce((s, r) => s + effectivePrice(r.matId) * r.flow, 0);
        const dailyCost   = netInputs.reduce((s, r) => s + effectivePrice(r.matId) * Math.abs(r.flow), 0);
        mkNetProfitRow(container, dailyIncome, dailyCost, 'display:flex;justify-content:space-between;align-items:center;padding:4px 0 2px;border-top:1px solid #1e1e3a;margin-top:3px;');
      }
    }
  } else {
    // ── Aggregate view — net flow across all bases ──
    const flowMap    = buildFlowMap(bases);
    const netInputs  = [...flowMap.values()].filter(r => r.flow < -0.01).sort((a, b) => a.flow - b.flow);
    const netOutputs = [...flowMap.values()].filter(r => r.flow >  0.01).sort((a, b) => b.flow - a.flow);

    if (!netInputs.length && !netOutputs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#6b6b8a;font-style:italic;padding:4px 0;';
      empty.textContent = 'No active production detected.';
      container.appendChild(empty);
    } else {
      if (netInputs.length)  { mkSection('Net Inputs',  container); netInputs.forEach(r  => renderFlowRow(r.name, r.matId, r.flow, r.inStock, container)); }
      if (netOutputs.length) { mkSection('Net Outputs', container); netOutputs.forEach(r => renderFlowRow(r.name, r.matId, r.flow, r.inStock, container)); }

      if (_priceMap && (netInputs.length || netOutputs.length)) {
        const dailyIncome = netOutputs.reduce((s, r) => s + effectivePrice(r.matId) * r.flow, 0);
        const dailyCost   = netInputs.reduce((s, r) => s + effectivePrice(r.matId) * Math.abs(r.flow), 0);
        mkNetProfitRow(container, dailyIncome, dailyCost, 'display:flex;justify-content:space-between;align-items:center;padding:5px 0 2px;border-top:2px solid #1e1e3a;margin-top:4px;');
      }
    }
  }
}

function toggleSummaryPanel() {
  const existing = document.getElementById(GT_SUMMARY_ID);
  if (existing) { existing.remove(); _summaryOpen = false; return; }

  closeAllPanels();
  const panel = mkPanelBase(GT_SUMMARY_ID, true);
  panel.style.width = '340px';

  // Header row with title + per-base toggle
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
  const titleEl = mkLabel('Summary');
  const viewToggle = document.createElement('button');
  const updateViewToggle = () => {
    viewToggle.textContent = _summaryPerBase ? 'Aggregate view' : 'Per-base view';
  };
  viewToggle.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;color:#6b6b8a;padding:0;font-family:inherit;';
  updateViewToggle();
  viewToggle.addEventListener('click', () => {
    _summaryPerBase = !_summaryPerBase;
    updateViewToggle();
    buildSummaryContent(content, _summaryPerBase);
  });
  const stockToggle = document.createElement('button');
  stockToggle.style.cssText = 'background:none;border:none;cursor:pointer;font-size:10px;color:#6b6b8a;padding:0;font-family:inherit;';
  stockToggle.textContent = _summaryShowStock ? 'Hide stock' : 'Show stock';
  stockToggle.addEventListener('click', () => {
    _summaryShowStock = !_summaryShowStock;
    stockToggle.textContent = _summaryShowStock ? 'Hide stock' : 'Show stock';
    buildSummaryContent(content, _summaryPerBase);
  });
  const hdrRight = document.createElement('div');
  hdrRight.style.cssText = 'display:flex;align-items:center;gap:10px;';
  hdrRight.appendChild(stockToggle);
  hdrRight.appendChild(viewToggle);
  hdr.appendChild(titleEl); hdr.appendChild(hdrRight);
  panel.appendChild(hdr);

  const content = document.createElement('div');
  panel.appendChild(content);

  if (_settings.showCosts && !_priceMap) {
    fetchMatPrices().then(() => buildSummaryContent(content, _summaryPerBase));
  }
  buildSummaryContent(content, _summaryPerBase);

  document.body.appendChild(panel);
  _summaryOpen = true;
}

// ── Header injection ──────────────────────────────────────────────────────────

async function loadAndInjectHeader() {
  await loadSettings();

  try {
    const gamedata = await loadGamedata();
    const bases    = await fetchBases().catch(() => []);
    _loadedHeaderBases    = bases;
    _loadedHeaderGamedata = gamedata;

    removeProductionUI();

    // Spacer div as first body child — pushes the game's content down
    const spacer = document.createElement('div');
    spacer.id = GT_SPACER_ID;
    spacer.style.cssText = `height:${HEADER_H}px;width:100%;pointer-events:none;flex-shrink:0;`;
    document.body.insertBefore(spacer, document.body.firstChild);

    // Add bottom padding so game content isn't hidden behind the fixed navbar.
    if (!document.getElementById('gt-overscroll-fix')) {
      const s = document.createElement('style');
      s.id = 'gt-overscroll-fix';
      const navH = getGameBottomNavH();
      const extraPad = navH > 0 ? navH : 56; // fallback 56px if nav not yet in DOM
      s.textContent = `body { padding-bottom: ${extraPad}px !important; }`;
      document.head.appendChild(s);
    }

    // Header bar — two-column layout: chip area (left, grows) + controls (right, fixed)
    const header = document.createElement('div');
    header.id = GT_HEADER_ID;
    Object.assign(header.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      background: '#0a0a18',
      borderBottom: '1px solid #1a1a30',
      display: 'flex', alignItems: 'flex-start',
      zIndex: '2147483646', overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif', fontSize: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    });

    // Chip area — grows, wraps when expanded
    const chipArea = document.createElement('div');
    chipArea.id = GT_CHIPAREA_ID;
    chipArea.dataset.chipArea = '1';
    Object.assign(chipArea.style, {
      flex: '1', minWidth: '0',
      display: 'flex', flexWrap: 'nowrap', alignItems: 'center',
      gap: '6px', padding: `6px 6px 6px 10px`,
      overflow: 'hidden',
    });

    const badge = document.createElement('img');
    badge.src = chrome.runtime.getURL('GTE16.png');
    badge.style.cssText = 'width:16px;height:16px;flex-shrink:0;margin-right:4px;opacity:0.7;';
    badge.title = 'Galactic Track Extension';
    chipArea.appendChild(badge);

    const apiKey = await getExtApiKey();
    const sorted = sortBases(bases).filter(b => !_settings.hiddenBases.includes(String(b.id)));

    const hint = document.createElement('span');
    hint.style.cssText = 'color:#3a3a5a;font-size:11px;padding:0 4px;white-space:nowrap;';

    if (!apiKey) {
      // No key yet — prompt user
      hint.textContent = 'Submit an API key in ⚙ Settings to view your bases';
      chipArea.appendChild(hint);
    } else if (!Array.isArray(_companyData?.perks)) {
      // Key present but perk data not yet loaded — wait then inject chips
      hint.textContent = 'Loading…';
      chipArea.appendChild(hint);
      const pollPerks = setInterval(async () => {
        if (!Array.isArray(_companyData?.perks)) return;
        clearInterval(pollPerks);
        hint.remove();
        const s = sortBases(_loadedHeaderBases ?? []).filter(b => !_settings.hiddenBases.includes(String(b.id)));
        for (const base of s) chipArea.insertBefore(buildHeaderChip(base, gamedata), overflowBadge);
        syncOverflowBadge();
      }, 500);
    } else if (sorted.length) {
      for (const base of sorted) chipArea.appendChild(buildHeaderChip(base, gamedata));
    } else {
      hint.textContent = 'No bases found — make sure you are logged into the game';
      chipArea.appendChild(hint);
    }

    // Overflow badge — shows "+N" with worst hidden-chip colour when bar is collapsed
    const overflowBadge = document.createElement('div');
    overflowBadge.style.cssText = [
      'display:none', 'align-items:center', 'gap:4px',
      'padding:0 8px', 'height:26px',
      'background:#111128', 'border:1px solid #2a2a4a', 'border-radius:4px',
      'font-size:11px', 'font-weight:600', 'white-space:nowrap',
      'flex-shrink:0', 'cursor:pointer',
    ].join(';');
    overflowBadge.title = 'Hidden bases — click to expand';
    overflowBadge.addEventListener('click', () => setExpanded(true));
    chipArea.appendChild(overflowBadge);

    function syncOverflowBadge() {
      if (_expanded) { overflowBadge.style.display = 'none'; return; }
      const areaRight = chipArea.getBoundingClientRect().right;
      const chips = [...chipArea.querySelectorAll('[data-base-id]')];
      const hidden = chips.filter(c => c.getBoundingClientRect().right > areaRight + 2);
      if (!hidden.length) { overflowBadge.style.display = 'none'; return; }
      // Determine worst colour among hidden chips
      const colours = hidden.map(c => {
        const timer = c.querySelector('span[style*="font-weight:600"]');
        return timer?.style.color ?? '#6b6b8a';
      });
      const worst = colours.includes(COL_CRIT) ? COL_CRIT
                  : colours.includes(COL_LOW)  ? COL_LOW
                  : COL_OK;
      overflowBadge.style.display = 'flex';
      overflowBadge.style.color = worst;
      overflowBadge.style.borderColor = worst === COL_CRIT ? '#7f1d1d'
                                       : worst === COL_LOW  ? '#78350f'
                                       : '#14532d';
      overflowBadge.textContent = `+${hidden.length}`;
    }

    _syncOverflowBadge = syncOverflowBadge;
    header.appendChild(chipArea);

    // Controls column — always right-aligned, fixed height, never wraps
    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '0 10px', flexShrink: '0',
      height: `${HEADER_H}px`,
    });

    // ── Helper: rounded square control button ────────────────────────────────
    function mkCtrlBtn(content, title) {
      const btn = document.createElement('span');
      btn.title = title;
      btn.innerHTML = content;
      btn.style.cssText = [
        'display:inline-flex', 'align-items:center', 'justify-content:center',
        'width:26px', 'height:26px',
        'border-radius:5px', 'border:1px solid #1e1e38',
        'background:#111128', 'color:#6b6b8a',
        'cursor:pointer', 'font-size:13px', 'flex-shrink:0',
        'transition:background 0.15s,color 0.15s,border-color 0.15s',
        'user-select:none',
      ].join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#1e1e3a';
        btn.style.borderColor = '#3a3a5a';
        btn.style.color = '#d8d8f0';
      });
      btn.addEventListener('mouseleave', () => {
        if (!btn.dataset.active) {
          btn.style.background = '#111128';
          btn.style.borderColor = '#1e1e38';
          btn.style.color = '#6b6b8a';
        }
      });
      btn.addEventListener('mousedown', () => { btn.style.background = '#28284a'; });
      btn.addEventListener('mouseup',   () => { btn.style.background = btn.dataset.active ? '#1e1e3a' : '#111128'; });
      return btn;
    }

    function setCtrlActive(btn, on) {
      btn.dataset.active = on ? '1' : '';
      btn.style.background   = on ? '#1e1e3a' : '#111128';
      btn.style.borderColor  = on ? '#4f46e5' : '#1e1e38';
      btn.style.color        = on ? '#a78bfa' : '#6b6b8a';
    }

    let _expanded = false;
    const expandBtn = mkCtrlBtn('\u25be', 'Expand / collapse bases');
    const setExpanded = (on) => {
      _expanded = on;
      expandBtn.innerHTML = on ? '\u25b4' : '\u25be';
      setCtrlActive(expandBtn, on);
      chipArea.style.flexWrap    = on ? 'wrap' : 'nowrap';
      chipArea.style.alignItems  = on ? 'flex-start' : 'center';
      requestAnimationFrame(syncOverflowBadge);
    };
    setExpanded(false);
    expandBtn.addEventListener('click', () => setExpanded(!_expanded));
    controls.appendChild(expandBtn);

    const refreshBtn = mkCtrlBtn('↻', 'Refresh data');
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.style.opacity = '0.4';
      refreshBtn.style.pointerEvents = 'none';
      await refreshChips();
      refreshBtn.style.opacity = '';
      refreshBtn.style.pointerEvents = '';
    });
    controls.appendChild(refreshBtn);

    if (_settings.showSummary) {
      const summaryBtn = mkCtrlBtn('\u03a3', 'Summary');
      summaryBtn.addEventListener('click', toggleSummaryPanel);
      controls.appendChild(summaryBtn);
    }

    if (_settings.showAssets) {
      const cashBtn = mkCtrlBtn('\u24c4', 'Cash & assets');
      cashBtn.addEventListener('click', toggleCashPanel);
      controls.appendChild(cashBtn);
    }

    if (_settings.showWishlistAll) {
      const wishAllBtn = mkCtrlBtn('&#128722;', 'Wishlist all panel');
      wishAllBtn.addEventListener('click', () => {
        showWishlistAllModal(opts => handleWishlistAll(wishAllBtn, opts));
      });
      controls.appendChild(wishAllBtn);
    }


    const gearBtn = mkCtrlBtn('\u2699', 'Settings');
    gearBtn.addEventListener('click', toggleSettingsPanel);
    controls.appendChild(gearBtn);

    header.appendChild(controls);
    // Collapse tab — sticks out below the header
    const tab = document.createElement('div');
    tab.id = GT_TAB_ID;
    Object.assign(tab.style, {
      position: 'fixed', top: `${HEADER_H}px`, right: '24px',
      background: '#0a0a18', border: '1px solid #1a1a30',
      borderTop: 'none', borderRadius: '0 0 8px 8px',
      padding: '1px 16px 3px', cursor: 'pointer',
      zIndex: '2147483644', color: '#3a3a5a',
      fontSize: '9px', lineHeight: '1',
      transition: 'top 0.25s ease, color 0.15s',
      userSelect: 'none', fontFamily: 'system-ui, sans-serif',
    });
    tab.textContent = '\u25b2'; // ▲
    tab.title = 'Collapse GT header';
    tab.addEventListener('mouseenter', () => { tab.style.color = '#7a7a9a'; });
    tab.addEventListener('mouseleave', () => { tab.style.color = _headerCollapsed ? '#6b6b8a' : '#3a3a5a'; });

    header.style.transition = 'transform 0.25s ease';
    spacer.style.transition  = 'height 0.25s ease';

    tab.addEventListener('click', () => {
      _headerCollapsed = !_headerCollapsed;
      if (_headerCollapsed) {
        header.style.transform = `translateY(-${header.offsetHeight}px)`;
        tab.style.top = '0';
        tab.textContent = '\u25bc'; // ▼
        tab.title = 'Expand GT header';
        spacer.style.height = '0';
        document.getElementById(GT_DETAIL_ID)?.remove();
        document.getElementById(GT_SETTINGS_ID)?.remove();
        _detailBaseId = null; _settingsOpen = false;
      } else {
        header.style.transform = '';
        tab.style.top = `${header.offsetHeight}px`;
        tab.textContent = '\u25b2';
        tab.title = 'Collapse GT header';
        // spacer will be synced by RO after transition
        setTimeout(() => {
          spacer.style.height = header.offsetHeight + 'px';
        }, 260);
      }
    });
    document.body.appendChild(tab);
    document.body.appendChild(header);

    // Right-edge panel wishlist button
    if (_settings.showWishlistPanel !== false) {
      const pwBtn = document.createElement('div');
      pwBtn.id = GT_PANEL_WISHLIST_BTN_ID;
      pwBtn.title = 'Wishlist Panel';
      pwBtn.style.cssText = [
        'position:fixed', 'right:0', 'top:50%', 'transform:translateY(-50%)',
        'z-index:2147483640',
        'background:#0a0a18', 'border:1px solid #1a1a38', 'border-right:none',
        'border-radius:6px 0 0 6px',
        'padding:10px 5px',
        'cursor:pointer',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'font-family:system-ui,sans-serif',
      ].join(';');

      const pwBtnText = document.createElement('span');
      pwBtnText.style.cssText = 'writing-mode:vertical-rl;transform:rotate(180deg);font-size:10px;color:#6b6b8a;letter-spacing:.05em;user-select:none;';
      pwBtnText.textContent = 'Wishlist';

      pwBtn.appendChild(pwBtnText);
      pwBtn.addEventListener('mouseenter', () => { pwBtn.style.background = '#111128'; pwBtnText.style.color = '#d8d8f0'; });
      pwBtn.addEventListener('mouseleave', () => { pwBtn.style.background = '#0a0a18'; _updatePanelWishlistBtn(); });
      pwBtn.addEventListener('click', togglePanelWishlist);
      document.body.appendChild(pwBtn);
      _updatePanelWishlistBtn();
    }

    // Keep spacer + tab + all floating panels in sync with header height
    _headerResizeObs = new ResizeObserver(() => {
      if (_headerCollapsed) return;
      const h = header.offsetHeight;
      spacer.style.height = h + 'px';
      tab.style.top = h + 'px';
      [GT_DETAIL_ID, GT_SETTINGS_ID, GT_CASH_ID, GT_SUMMARY_ID, GT_FLIGHT_ID, GT_WISHLIST_ALL_ID].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.top = h + 'px';
      });
      _updatePanelWishlistBtn();
      syncOverflowBadge();
    });
    _headerResizeObs.observe(header);

    // Close panels when clicking anywhere outside the extension UI
    if (!_outsideClickBound) {
      _outsideClickBound = true;
      document.addEventListener('click', (e) => {
        const extIds = [GT_HEADER_ID, GT_DETAIL_ID, GT_SETTINGS_ID, GT_CASH_ID, GT_SUMMARY_ID, GT_TAB_ID, GT_TOAST_ID, GT_CUSTOM_PRICES_ID, GT_PANEL_WISHLIST_ID, GT_PANEL_WISHLIST_BTN_ID, GT_FLIGHT_ID, GT_WISHLIST_ALL_ID];
        const inExt = extIds.some(id => document.getElementById(id)?.contains(e.target));
        if (!inExt && (_detailBaseId || _settingsOpen || _cashOpen || _summaryOpen || _flightOpen || _wishlistAllOpen)) {
          closeAllPanels();
        }
      }, false);
    }
  } catch { /* silently skip — header is optional enhancement */ }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

(function initProductionTracker() {
  chrome.storage.local.get('enabled', ({ enabled }) => {
    if (enabled !== false) {
      loadSprite();
      loadAndInjectHeader();
      fetchCompanyData(); // warm cache + pull perks from GT API on first load only
      watchGteNav();
      watchBuildingModal();
      watchFlightModal();
      watchContractsPage();
      watchBuildingGrid();
      // Refresh local API data + rebuild header chips every 5 minutes — no GT API / API key calls
      setInterval(refreshChips, 5 * 60 * 1000);
      // Retry header injection until the game's local API is ready (SPA may load after content script)
      let retries = 0;
      const retryTimer = setInterval(async () => {
        if (_loadedHeaderBases?.length || retries++ >= 10) { clearInterval(retryTimer); return; }
        const company = await requestGTLocalAPI('getMyCompany');
        const bases = company?.bases ?? company?.buildingBases ?? (Array.isArray(company) ? company : null);
        if (Array.isArray(bases) && bases.length) {
          clearInterval(retryTimer);
          loadAndInjectHeader();
        }
      }, 3000);
    }
  });
})();

chrome.storage.onChanged.addListener((changes) => {
  if (!('enabled' in changes)) return;
  if (changes.enabled.newValue === false) {
    removeProductionUI();
    document.getElementById(GT_SETTINGS_ID)?.remove();
    document.getElementById(GT_TOAST_ID)?.remove();
    document.getElementById(GT_CUSTOM_PRICES_ID)?.remove();
    document.getElementById(GTE_MODAL_ID)?.remove();
    document.getElementById(GTE_NAV_ID)?.remove();
    _settingsOpen = false;
  } else {
    loadAndInjectHeader();
    watchGteNav();
  }
});

// ── GTE — Guild Trade Board in-game ───────────────────────────────────────────

const GTE_MODAL_ID = 'gt-gte-modal';
const GTE_NAV_ID   = 'gt-gte-nav';
const GTE_LEFT_ID  = 'gt-gte-left';
const GTE_RIGHT_ID = 'gt-gte-right';

// ── GTE State ─────────────────────────────────────────────────────────────────

let _gteListings    = [];
let _gteMyListings  = [];
let _gteItems       = [];
let _gtePlanets     = ['Exchange Station'];
let _gteLoading     = false;
let _gteNoGuild     = false;
let _gteErr         = null;
let _gteExpandedMat = null;
let _gteCanWrite    = false;
let _gteSessionToken = null;
let _gteDataLoaded  = false;
let _gteSearchQ     = '';
let _gteFormMode    = null;   // 'new' | 'add-loc' | 'edit-loc'
let _gteFormCtx     = null;   // { listingId?, locId?, matId?, matName? }
let _gteNavObs       = null;
let _headerResizeObs = null;
let _outsideClickBound = false;
let _escHandler      = null;

// ── GTE Auth helpers ──────────────────────────────────────────────────────────

async function gteAutoLogin() {
  // 1. Try local API (game may expose key directly — zero user setup)
  let apiKey = null;
  const localKey = await requestGTLocalAPI('getApiKey');
  if (localKey && typeof localKey === 'string') apiKey = localKey;

  // 2. Fall back to stored extended API key
  if (!apiKey) {
    const { gtExtApiKey } = await chrome.storage.local.get(['gtExtApiKey']);
    apiKey = gtExtApiKey ?? null;
  }

  if (!apiKey) throw new Error('No API key — set one in Settings (\u2699).');

  const res = await fetch(`${GT_TRACK}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error || res.statusText);
  }
  const data = await res.json();
  _gteSessionToken = data.sessionToken;
  return _gteSessionToken;
}

async function gteFetch(path, method = 'GET', body = null) {
  if (!_gteSessionToken) await gteAutoLogin();
  const doReq = async (token) => {
    const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(`${GT_TRACK}/api${path}`, opts);
  };
  let res = await doReq(_gteSessionToken);
  if (res.status === 401) {
    _gteSessionToken = null;
    await gteAutoLogin();
    res = await doReq(_gteSessionToken);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error || res.statusText);
  }
  return res.json();
}

function gteRelTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (!isFinite(diff) || diff < 0) return '—';
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Location form (self-contained — no focus loss on toggle clicks) ───────────

function buildGteLocForm(init, planets, label, onSubmit, onCancel) {
  let priceType  = init.priceType  ?? 'fixed';
  let stockLevel = init.stockLevel ?? 'high';
  let planet     = init.planet     ?? '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:8px 12px;background:#0a0a1a;border-top:1px solid #1a1a35;';

  // ── Row 1: price type + value + stock toggles ──────────────────────────────
  const row1 = document.createElement('div');
  row1.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:7px;';

  const priceInput = document.createElement('input');
  priceInput.type = 'text';
  priceInput.value = init.priceRaw ?? '';
  priceInput.placeholder = priceType === 'fixed' ? 'e.g. 1650' : 'offset e.g. 1';
  priceInput.style.cssText = 'width:88px;padding:4px 8px;background:#0d0d1f;border:1px solid #2a2a4a;border-radius:4px;color:#d8d8f0;font-size:12px;outline:none;font-family:inherit;';
  if (priceType === 'average') priceInput.style.display = 'none';

  [['Fixed','fixed'],['Market −N','market_offset'],['Average','average']].forEach(([lbl, val]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = lbl;
    btn.dataset.pt = val;
    const active = priceType === val;
    btn.style.cssText = `padding:4px 9px;background:${active?'#3730a3':'transparent'};border:1px solid ${active?'#4f46e5':'#2a2a4a'};border-radius:4px;color:${active?'#d8d8f0':'#6b6b8a'};font-size:11px;cursor:pointer;font-family:inherit;`;
    btn.addEventListener('click', () => {
      priceType = val;
      priceInput.style.display = val === 'average' ? 'none' : 'inline-block';
      priceInput.placeholder = val === 'fixed' ? 'e.g. 1650' : 'offset e.g. 1';
      row1.querySelectorAll('[data-pt]').forEach(b => {
        const a = b.dataset.pt === priceType;
        b.style.background = a ? '#3730a3' : 'transparent';
        b.style.borderColor = a ? '#4f46e5' : '#2a2a4a';
        b.style.color = a ? '#d8d8f0' : '#6b6b8a';
      });
    });
    row1.appendChild(btn);
  });
  row1.appendChild(priceInput);

  [['High','high'],['Low','low'],['To Order','to_order']].forEach(([lbl, val]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = lbl;
    btn.dataset.sl = val;
    const active = stockLevel === val;
    btn.style.cssText = `padding:4px 9px;background:${active?'#3730a3':'transparent'};border:1px solid ${active?'#4f46e5':'#2a2a4a'};border-radius:4px;color:${active?'#d8d8f0':'#6b6b8a'};font-size:11px;cursor:pointer;font-family:inherit;`;
    btn.addEventListener('click', () => {
      stockLevel = val;
      row1.querySelectorAll('[data-sl]').forEach(b => {
        const a = b.dataset.sl === stockLevel;
        b.style.background = a ? '#3730a3' : 'transparent';
        b.style.borderColor = a ? '#4f46e5' : '#2a2a4a';
        b.style.color = a ? '#d8d8f0' : '#6b6b8a';
      });
    });
    row1.appendChild(btn);
  });

  // ── Row 2: planet picker + buttons ────────────────────────────────────────
  const row2 = document.createElement('div');
  row2.style.cssText = 'display:flex;gap:6px;align-items:flex-start;';

  const planetWrap = document.createElement('div');
  planetWrap.style.cssText = 'position:relative;flex:1;min-width:0;';

  const planetInp = document.createElement('input');
  planetInp.type = 'text';
  planetInp.value = init.planet ?? 'Exchange Station';
  if (init.planet) planet = init.planet;
  planetInp.placeholder = 'Search location…';
  planetInp.style.cssText = `width:100%;box-sizing:border-box;background:#0d0d1f;border:1px solid ${planet?'#4c1d95':'#2a2a4a'};border-radius:4px;padding:5px 9px;color:#e0e0ff;font-size:12px;outline:none;font-family:inherit;`;

  const planetDrop = document.createElement('div');
  planetDrop.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:300;background:#0d0d1f;border:1px solid #2a2a4a;border-radius:5px;margin-top:2px;max-height:160px;overflow-y:auto;display:none;';

  function updatePlanetDrop() {
    const q = planetInp.value.toLowerCase();
    const matches = planets.filter(p => p.toLowerCase().includes(q)).slice(0, 10);
    planetDrop.innerHTML = '';
    if (!matches.length) { planetDrop.style.display = 'none'; return; }
    matches.forEach(p => {
      const opt = document.createElement('div');
      opt.textContent = p;
      opt.style.cssText = 'padding:6px 10px;font-size:12px;color:#c4c4e0;cursor:pointer;';
      opt.addEventListener('mousedown', e => {
        e.preventDefault();
        planet = p; planetInp.value = p;
        planetInp.style.borderColor = '#4c1d95';
        planetDrop.style.display = 'none';
      });
      opt.addEventListener('mouseenter', () => { opt.style.background = '#1e1e3a'; });
      opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
      planetDrop.appendChild(opt);
    });
    planetDrop.style.display = 'block';
  }

  planetInp.addEventListener('focus', updatePlanetDrop);
  planetInp.addEventListener('input', () => { planet = ''; planetInp.style.borderColor = '#2a2a4a'; updatePlanetDrop(); });
  planetInp.addEventListener('blur', () => setTimeout(() => { planetDrop.style.display = 'none'; }, 160));

  planetWrap.appendChild(planetInp);
  planetWrap.appendChild(planetDrop);
  row2.appendChild(planetWrap);

  if (onCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'background:none;border:none;color:#6b6b8a;cursor:pointer;font-size:12px;padding:5px 6px;white-space:nowrap;flex-shrink:0;font-family:inherit;';
    cancelBtn.addEventListener('click', onCancel);
    row2.appendChild(cancelBtn);
  }

  const errSpan = document.createElement('span');
  errSpan.style.cssText = 'display:block;font-size:11px;color:#ef4444;margin-top:4px;min-height:14px;';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = label;
  submitBtn.style.cssText = 'padding:5px 12px;background:#3730a3;border:1px solid #4f46e5;border-radius:5px;color:#d8d8f0;font-size:12px;white-space:nowrap;flex-shrink:0;cursor:pointer;font-family:inherit;';
  submitBtn.addEventListener('click', async () => {
    const priceRaw = priceInput.value.trim();
    errSpan.textContent = '';
    let price_value = 0;
    if (priceType === 'fixed') {
      if (!/^\d+$/.test(priceRaw)) { errSpan.textContent = 'Enter a whole number'; return; }
      price_value = parseInt(priceRaw, 10);
    } else if (priceType === 'market_offset') {
      if (!/^\d+$/.test(priceRaw)) { errSpan.textContent = 'Enter the offset e.g. 1'; return; }
      price_value = -parseInt(priceRaw, 10);
    }
    if (!planet) { errSpan.textContent = 'Select a location'; return; }
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    try {
      await onSubmit({ price_type: priceType, price_value, stock_level: stockLevel, location: planet });
    } catch (e) {
      errSpan.textContent = e.message;
      submitBtn.disabled = false; submitBtn.textContent = label;
    }
  });
  row2.appendChild(submitBtn);

  wrap.appendChild(row1);
  wrap.appendChild(row2);
  wrap.appendChild(errSpan);
  return wrap;
}

// ── GTE Data loading ──────────────────────────────────────────────────────────

function makeSpinner() {
  if (!document.getElementById('gt-spin-style')) {
    const s = document.createElement('style');
    s.id = 'gt-spin-style';
    s.textContent = '@keyframes gt-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;justify-content:center;align-items:center;padding:48px;';
  const ring = document.createElement('div');
  ring.style.cssText = 'width:32px;height:32px;border-radius:50%;border:3px solid #1a1a35;border-top-color:#6366f1;animation:gt-spin 0.7s linear infinite;';
  wrap.appendChild(ring);
  return wrap;
}

async function gteLoadData(forceRefresh = false) {
  if (!forceRefresh && _gteDataLoaded) { gteRenderBoth(); return; }

  _gteLoading = true; _gteErr = null; _gteNoGuild = false;
  gteRenderBoth();

  try {
    const identity = await resolveIdentity();
    const gTag = identity?.gTag ?? '';

    if (!gTag) {
      _gteNoGuild = true;
      _gteDataLoaded = true;
      return;
    }

    const [publicListings, items, gamedata] = await Promise.all([
      gTag
        ? fetch(`${GT_TRACK}/api/trade/public?tag=${encodeURIComponent(gTag)}`).then(r => r.ok ? r.json() : []).catch(() => [])
        : Promise.resolve([]),
      fetch(`${GT_TRACK}/api/items`).then(r => r.ok ? r.json() : []).catch(() => []),
      loadGamedata(),
    ]);

    _gteListings = Array.isArray(publicListings) ? publicListings : [];
    _gteItems    = Array.isArray(items) ? items : [];

    const names = (gamedata?.systems ?? []).flatMap(s => s.planets ?? []).map(p => p.name).filter(Boolean).sort();
    if (!names.includes('Exchange Station')) names.unshift('Exchange Station');
    _gtePlanets = names.length ? names : ['Exchange Station'];

    try {
      await gteAutoLogin();
      const myLs = await gteFetch('/trade');
      _gteMyListings = Array.isArray(myLs) ? myLs : [];
      _gteCanWrite = true;
    } catch {
      _gteMyListings = [];
      _gteCanWrite = false;
    }

    _gteDataLoaded = true;
  } catch (e) {
    _gteErr = e.message;
  } finally {
    _gteLoading = false;
  }

  gteRenderBoth();
}

async function gteRefreshPublic() {
  try {
    const identity = await resolveIdentity();
    if (!identity?.gTag) return;
    const pls = await fetch(`${GT_TRACK}/api/trade/public?tag=${encodeURIComponent(identity.gTag)}`).then(r => r.ok ? r.json() : []).catch(() => []);
    _gteListings = Array.isArray(pls) ? pls : [];
  } catch { /* silent */ }
}

async function gteRefreshMine() {
  try {
    const myLs = await gteFetch('/trade');
    _gteMyListings = Array.isArray(myLs) ? myLs : [];
  } catch { _gteMyListings = []; }
}

// ── GTE Render ────────────────────────────────────────────────────────────────

function gteRenderBoth() { gteRenderLeft(); gteRenderRight(); }

function gteRenderLeft() {
  const col = document.getElementById(GTE_LEFT_ID);
  if (!col) return;
  col.innerHTML = '';

  // Column header + search
  const colHdr = document.createElement('div');
  colHdr.style.cssText = 'padding:8px 12px;border-bottom:1px solid #1a1a35;display:flex;align-items:center;gap:8px;';
  const colTitle = document.createElement('span');
  colTitle.style.cssText = 'font-size:12px;font-weight:600;color:#6b6b8a;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0;';
  colTitle.textContent = 'Guild Listings';
  const searchInp = document.createElement('input');
  searchInp.placeholder = 'Search items…';
  searchInp.value = _gteSearchQ;
  searchInp.style.cssText = 'flex:1;padding:4px 9px;background:#13132a;border:1px solid #1e1e3a;border-radius:5px;color:#d8d8f0;font-size:12px;outline:none;font-family:inherit;';
  searchInp.addEventListener('input', () => { _gteSearchQ = searchInp.value.trim().toLowerCase(); renderGroups(); });
  colHdr.appendChild(colTitle);
  colHdr.appendChild(searchInp);
  col.appendChild(colHdr);

  const listArea = document.createElement('div');
  col.appendChild(listArea);

  function renderGroups() {
    const scrollTop = listArea.scrollTop;
    listArea.innerHTML = '';
    if (_gteLoading) { listArea.appendChild(makeSpinner()); return; }
    if (_gteNoGuild) {
      const d = document.createElement('div');
      d.style.cssText = 'padding:32px 20px;color:#4a4a6a;font-size:13px;text-align:center;line-height:1.6;';
      d.textContent = 'Join a guild to use Guild Trade.';
      listArea.appendChild(d);
      return;
    }
    if (_gteErr) {
      const d = document.createElement('div');
      d.style.cssText = 'padding:20px;color:#ef4444;font-size:13px;';
      d.textContent = _gteErr;
      listArea.appendChild(d);
      return;
    }

    const map = new Map();
    for (const l of _gteListings) {
      if (!map.has(l.mat_id)) map.set(l.mat_id, { mat_id: l.mat_id, mat_name: l.mat_name ?? '', rows: [] });
      map.get(l.mat_id).rows.push(l);
    }
    let groups = Array.from(map.values());
    if (_gteSearchQ) groups = groups.filter(g => g.mat_name.toLowerCase().includes(_gteSearchQ));
    groups.sort((a, b) => (a.mat_name ?? '').localeCompare(b.mat_name ?? ''));

    if (groups.length === 0) {
      listArea.innerHTML = `<div style="padding:32px;text-align:center;color:#4a4a6a;font-size:14px;">${
        _gteListings.length === 0 ? 'No guild listings yet.' : `No items match "${_gteSearchQ}"`
      }</div>`;
      return;
    }

    groups.forEach((group, gi) => {
      const isExpanded = _gteExpandedMat === group.mat_id;
      const allLocs = group.rows.flatMap(r => r.locations ?? []);
      const fixed = allLocs.filter(l => l.price_type !== 'average');
      const bestLoc = (fixed.length ? fixed : allLocs).reduce((a, b) => (a && a.price_value <= b.price_value) ? a : b, null);

      const groupEl = document.createElement('div');
      if (gi > 0) groupEl.style.borderTop = '1px solid #1a1a35';

      // Item row header
      const itemRow = document.createElement('div');
      itemRow.style.cssText = `display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;background:${isExpanded?'#0f0f2a':'#0d0d22'};`;
      itemRow.addEventListener('mouseenter', () => { if (!isExpanded) itemRow.style.background = '#0f0f2a'; });
      itemRow.addEventListener('mouseleave', () => { if (!isExpanded) itemRow.style.background = '#0d0d22'; });
      itemRow.addEventListener('click', () => { _gteExpandedMat = isExpanded ? null : group.mat_id; gteRenderLeft(); });

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'font-size:13px;font-weight:600;color:#d8d8f0;flex:1;';
      nameSpan.textContent = group.mat_name;

      const priceSpan = document.createElement('span');
      priceSpan.style.cssText = 'font-size:13px;color:#c0c0e0;font-weight:500;margin-right:8px;';
      if (bestLoc) priceSpan.textContent = fmtPrice(bestLoc.price_type, bestLoc.price_value);

      const sellerSpan = document.createElement('span');
      sellerSpan.style.cssText = 'font-size:11px;color:#4a4a6a;margin-right:8px;';
      sellerSpan.textContent = `${group.rows.length} ${group.rows.length === 1 ? 'seller' : 'sellers'}`;

      const chevron = document.createElement('span');
      chevron.style.cssText = `font-size:12px;color:#4a4a6a;transition:transform 0.15s;display:inline-block;transform:${isExpanded?'rotate(90deg)':'none'};`;
      chevron.textContent = '›';

      const iconEl = makeIcon(group.mat_name, 18);
      if (iconEl) itemRow.appendChild(iconEl);
      itemRow.append(nameSpan, priceSpan, sellerSpan, chevron);
      groupEl.appendChild(itemRow);

      if (isExpanded) {
        group.rows.forEach(l => {
          const selRow = document.createElement('div');
          selRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 14px 6px 20px;background:#0a0a1e;border-top:1px solid #12122a;';
          const selName = document.createElement('span');
          selName.style.cssText = 'font-size:12px;color:#a0a0c8;font-weight:600;flex:1;';
          if (l.guild_tag) { const t = document.createElement('span'); t.style.color = '#5a5a90'; t.textContent = `[${l.guild_tag}] `; selName.appendChild(t); }
          selName.appendChild(document.createTextNode(l.company_name ?? ''));
          const timeSpan = document.createElement('span');
          timeSpan.style.cssText = 'font-size:11px;color:#3a3a5a;';
          timeSpan.textContent = gteRelTime(l.created_at);
          selRow.append(selName, timeSpan);
          groupEl.appendChild(selRow);

          (l.locations ?? []).forEach(loc => {
            const locRow = document.createElement('div');
            locRow.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 14px 4px 36px;background:#080818;border-top:1px solid #0e0e22;';
            const lp = document.createElement('span');
            lp.style.cssText = 'font-size:12px;font-weight:600;color:#e2e8f0;min-width:55px;';
            lp.textContent = fmtPrice(loc.price_type, loc.price_value);
            locRow.appendChild(lp);
            if (loc.stock_level) {
              const ss = document.createElement('span');
              ss.style.cssText = `font-size:11px;color:${STOCK_COLORS[loc.stock_level]??'#b0b0cc'};white-space:nowrap;`;
              ss.textContent = STOCK_LABELS[loc.stock_level] ?? loc.stock_level;
              locRow.appendChild(ss);
            }
            if (loc.location) {
              const ln = document.createElement('span');
              ln.style.cssText = 'font-size:11px;color:#4a4a6a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
              ln.textContent = loc.location;
              locRow.appendChild(ln);
            }
            groupEl.appendChild(locRow);
          });
        });
      }

      listArea.appendChild(groupEl);
    });
    listArea.scrollTop = scrollTop;
  }

  renderGroups();
}

function gteRenderRight() {
  const col = document.getElementById(GTE_RIGHT_ID);
  if (!col) return;
  const scrollTop = col.scrollTop;
  col.innerHTML = '';

  // Column header
  const colHdr = document.createElement('div');
  colHdr.style.cssText = 'padding:8px 12px;border-bottom:1px solid #1a1a35;display:flex;align-items:center;justify-content:space-between;';
  const colTitle = document.createElement('span');
  colTitle.style.cssText = 'font-size:12px;font-weight:600;color:#6b6b8a;text-transform:uppercase;letter-spacing:.06em;';
  colTitle.textContent = 'Your Listings';
  colHdr.appendChild(colTitle);
  if (_gteCanWrite && _gteMyListings.length > 0) {
    const cnt = document.createElement('span');
    cnt.style.cssText = 'font-size:11px;color:#3a3a5a;';
    cnt.textContent = _gteMyListings.length;
    colHdr.appendChild(cnt);
  }
  col.appendChild(colHdr);

  if (_gteLoading) { col.appendChild(makeSpinner()); return; }

  if (_gteNoGuild) { return; } // left column already shows the no-guild message

  // No API key — prompt to set one
  if (!_gteCanWrite) {
    const noTok = document.createElement('div');
    noTok.style.cssText = 'padding:20px 14px;color:#4a4a6a;font-size:12px;line-height:1.6;';
    noTok.textContent = 'Set your API key in Settings (\u2699) to manage your guild listings.';
    col.appendChild(noTok);
    return;
  }

  // Post Listing button (or active new-listing form header)
  if (_gteFormMode === 'new') {
    const newHdr = document.createElement('div');
    newHdr.style.cssText = 'padding:8px 12px;background:#0a0a1a;border-bottom:1px solid #1a1a35;display:flex;align-items:center;justify-content:space-between;';
    const newTitle = document.createElement('span');
    newTitle.style.cssText = 'font-size:12px;font-weight:600;color:#d8d8f0;';
    newTitle.textContent = _gteFormCtx?.matName ? _gteFormCtx.matName : 'New Listing';
    const cancelNew = document.createElement('button');
    cancelNew.type = 'button';
    cancelNew.textContent = '✕ Cancel';
    cancelNew.style.cssText = 'background:none;border:none;color:#6b6b8a;cursor:pointer;font-size:11px;font-family:inherit;';
    cancelNew.addEventListener('click', () => { _gteFormMode = null; _gteFormCtx = null; gteRenderRight(); });
    newHdr.append(newTitle, cancelNew);
    col.appendChild(newHdr);

    if (!_gteFormCtx?.matId) {
      // Step 1: item search
      const srchWrap = document.createElement('div');
      srchWrap.style.cssText = 'padding:10px 12px;border-bottom:1px solid #1a1a35;position:relative;';
      const srchInp = document.createElement('input');
      srchInp.placeholder = 'Search items…';
      srchInp.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 10px;background:#0d0d1f;border:1px solid #2a2a4a;border-radius:5px;color:#d8d8f0;font-size:13px;outline:none;font-family:inherit;';
      const srchDrop = document.createElement('div');
      srchDrop.style.cssText = 'position:absolute;top:100%;left:12px;right:12px;z-index:300;background:#0d0d1f;border:1px solid #2a2a4a;border-radius:5px;margin-top:2px;max-height:200px;overflow-y:auto;display:none;';
      function updateSrchDrop() {
        const q = srchInp.value.trim().toLowerCase();
        srchDrop.innerHTML = '';
        if (!q) { srchDrop.style.display = 'none'; return; }
        const matches = _gteItems.filter(i => (i.matName ?? i.mat_name ?? '').toLowerCase().includes(q)).slice(0, 12);
        if (!matches.length) { srchDrop.style.display = 'none'; return; }
        matches.forEach(item => {
          const opt = document.createElement('div');
          const nm = item.matName ?? item.mat_name ?? '';
          opt.style.cssText = 'padding:7px 10px;font-size:13px;color:#b0b0cc;cursor:pointer;display:flex;align-items:center;gap:6px;';
          const srchIcon = makeIcon(nm, 16);
          if (srchIcon) opt.appendChild(srchIcon);
          opt.appendChild(document.createTextNode(nm));
          opt.addEventListener('mouseenter', () => { opt.style.background = '#1a1a35'; });
          opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
          opt.addEventListener('mousedown', e => {
            e.preventDefault();
            _gteFormCtx = { matId: item.matId ?? item.mat_id, matName: nm };
            gteRenderRight();
          });
          srchDrop.appendChild(opt);
        });
        srchDrop.style.display = 'block';
      }
      srchInp.addEventListener('input', updateSrchDrop);
      srchInp.addEventListener('focus', updateSrchDrop);
      srchInp.addEventListener('blur', () => setTimeout(() => { srchDrop.style.display = 'none'; }, 160));
      srchWrap.append(srchInp, srchDrop);
      col.appendChild(srchWrap);
    } else {
      // Step 2: location form
      const locForm = buildGteLocForm(
        { priceType: 'fixed', priceRaw: '', stockLevel: 'high', planet: 'Exchange Station' },
        _gtePlanets, 'Post Listing',
        async (locData) => {
          const row = await gteFetch('/trade', 'POST', { mat_id: _gteFormCtx.matId, mat_name: _gteFormCtx.matName });
          await gteFetch(`/trade/${row.id}/locations`, 'POST', locData);
          await Promise.all([gteRefreshMine(), gteRefreshPublic()]);
          _gteFormMode = null; _gteFormCtx = null;
          gteRenderBoth();
        },
        null
      );
      col.appendChild(locForm);
    }
  } else {
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Post Listing';
    addBtn.style.cssText = 'display:block;width:100%;padding:8px 14px;background:#1e1440;border:none;border-bottom:1px solid #1a1a35;color:#a78bfa;font-size:12px;font-weight:600;cursor:pointer;text-align:left;font-family:inherit;';
    addBtn.addEventListener('mouseenter', () => { addBtn.style.background = '#2d1f5e'; });
    addBtn.addEventListener('mouseleave', () => { addBtn.style.background = '#1e1440'; });
    addBtn.addEventListener('click', () => { _gteFormMode = 'new'; _gteFormCtx = null; gteRenderRight(); });
    col.appendChild(addBtn);
  }

  // Own listings
  if (_gteMyListings.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px 12px;text-align:center;color:#3a3a5a;font-size:12px;';
    empty.textContent = 'No listings yet';
    col.appendChild(empty);
    return;
  }

  _gteMyListings.forEach(l => {
    const isAddingLoc = _gteFormMode === 'add-loc' && _gteFormCtx?.listingId === l.id;
    const editLocId   = _gteFormMode === 'edit-loc' && _gteFormCtx?.listingId === l.id ? _gteFormCtx.locId : null;

    const listingEl = document.createElement('div');
    listingEl.style.borderTop = '1px solid #1a1a35';

    // Item header
    const itemHdr = document.createElement('div');
    itemHdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;background:#0d0d22;';
    const matName = document.createElement('span');
    matName.style.cssText = 'font-size:13px;font-weight:600;color:#d8d8f0;flex:1;display:flex;align-items:center;gap:6px;';
    const matIcon = makeIcon(l.mat_name, 18);
    if (matIcon) matName.appendChild(matIcon);
    matName.appendChild(document.createTextNode(l.mat_name));

    const addLocBtn = document.createElement('button');
    addLocBtn.type = 'button';
    addLocBtn.textContent = '+ Location';
    addLocBtn.style.cssText = 'background:none;border:none;color:#4a4a6a;cursor:pointer;font-size:11px;padding:0 4px;font-family:inherit;';
    addLocBtn.addEventListener('mouseenter', () => { addLocBtn.style.color = '#a78bfa'; });
    addLocBtn.addEventListener('mouseleave', () => { addLocBtn.style.color = '#4a4a6a'; });
    addLocBtn.addEventListener('click', () => {
      if (_gteFormMode === 'add-loc' && _gteFormCtx?.listingId === l.id) { _gteFormMode = null; _gteFormCtx = null; }
      else { _gteFormMode = 'add-loc'; _gteFormCtx = { listingId: l.id }; }
      gteRenderRight();
    });

    const delListBtn = document.createElement('button');
    delListBtn.type = 'button';
    delListBtn.textContent = '✕';
    delListBtn.style.cssText = 'background:none;border:none;color:#4a4a6a;cursor:pointer;font-size:13px;padding:0 2px;font-family:inherit;';
    delListBtn.addEventListener('mouseenter', () => { delListBtn.style.color = '#ef4444'; });
    delListBtn.addEventListener('mouseleave', () => { delListBtn.style.color = '#4a4a6a'; });
    delListBtn.addEventListener('click', async () => {
      delListBtn.disabled = true;
      try {
        await gteFetch(`/trade/${l.id}`, 'DELETE');
        _gteMyListings = _gteMyListings.filter(x => x.id !== l.id);
        if (_gteFormCtx?.listingId === l.id) { _gteFormMode = null; _gteFormCtx = null; }
        await gteRefreshPublic();
        gteRenderBoth();
      } catch (e) {
        delListBtn.disabled = false;
      }
    });

    itemHdr.append(matName, addLocBtn, delListBtn);
    listingEl.appendChild(itemHdr);

    // Location rows
    (l.locations ?? []).forEach(loc => {
      if (editLocId === loc.id) {
        let priceRaw = '';
        if (loc.price_type === 'fixed') priceRaw = String(loc.price_value);
        else if (loc.price_type === 'market_offset') priceRaw = String(Math.abs(loc.price_value));
        const editForm = buildGteLocForm(
          { priceType: loc.price_type, priceRaw, stockLevel: loc.stock_level ?? 'high', planet: loc.location ?? '' },
          _gtePlanets, 'Save',
          async (locData) => {
            await gteFetch(`/trade/${l.id}/locations/${loc.id}`, 'PATCH', locData);
            await Promise.all([gteRefreshMine(), gteRefreshPublic()]);
            _gteFormMode = null; _gteFormCtx = null;
            gteRenderBoth();
          },
          () => { _gteFormMode = null; _gteFormCtx = null; gteRenderRight(); }
        );
        listingEl.appendChild(editForm);
      } else {
        const locRow = document.createElement('div');
        locRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 12px 4px 28px;background:#0a0a1e;border-top:1px solid #0e0e22;';
        const lp = document.createElement('span');
        lp.style.cssText = 'font-size:12px;font-weight:600;color:#e2e8f0;min-width:50px;';
        lp.textContent = fmtPrice(loc.price_type, loc.price_value);
        locRow.appendChild(lp);
        if (loc.stock_level) {
          const ss = document.createElement('span');
          ss.style.cssText = `font-size:11px;color:${STOCK_COLORS[loc.stock_level]??'#b0b0cc'};white-space:nowrap;`;
          ss.textContent = STOCK_LABELS[loc.stock_level] ?? loc.stock_level;
          locRow.appendChild(ss);
        }
        if (loc.location) {
          const ln = document.createElement('span');
          ln.style.cssText = 'font-size:11px;color:#4a4a6a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          ln.textContent = loc.location;
          locRow.appendChild(ln);
        }
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.style.cssText = 'background:none;border:none;color:#4a4a6a;cursor:pointer;font-size:11px;padding:0 2px;font-family:inherit;';
        editBtn.addEventListener('mouseenter', () => { editBtn.style.color = '#a78bfa'; });
        editBtn.addEventListener('mouseleave', () => { editBtn.style.color = '#4a4a6a'; });
        editBtn.addEventListener('click', () => { _gteFormMode = 'edit-loc'; _gteFormCtx = { listingId: l.id, locId: loc.id }; gteRenderRight(); });
        const locDelBtn = document.createElement('button');
        locDelBtn.textContent = '✕';
        locDelBtn.style.cssText = 'background:none;border:none;color:#4a4a6a;cursor:pointer;font-size:12px;padding:0 2px;font-family:inherit;';
        locDelBtn.addEventListener('mouseenter', () => { locDelBtn.style.color = '#ef4444'; });
        locDelBtn.addEventListener('mouseleave', () => { locDelBtn.style.color = '#4a4a6a'; });
        locDelBtn.addEventListener('click', async () => {
          locDelBtn.disabled = true;
          try {
            const isLast = (l.locations?.length ?? 0) === 1;
            await gteFetch(`/trade/${l.id}/locations/${loc.id}`, 'DELETE');
            if (isLast) {
              _gteMyListings = _gteMyListings.filter(x => x.id !== l.id);
              if (_gteFormCtx?.listingId === l.id) { _gteFormMode = null; _gteFormCtx = null; }
            } else {
              await gteRefreshMine();
            }
            await gteRefreshPublic();
            gteRenderBoth();
          } catch { locDelBtn.disabled = false; }
        });
        locRow.append(editBtn, locDelBtn);
        listingEl.appendChild(locRow);
      }
    });

    // Add-location form
    if (isAddingLoc) {
      const addLocForm = buildGteLocForm(
        { priceType: 'fixed', priceRaw: '', stockLevel: 'high', planet: 'Exchange Station' },
        _gtePlanets, 'Add Location',
        async (locData) => {
          await gteFetch(`/trade/${l.id}/locations`, 'POST', locData);
          await Promise.all([gteRefreshMine(), gteRefreshPublic()]);
          _gteFormMode = null; _gteFormCtx = null;
          gteRenderBoth();
        },
        () => { _gteFormMode = null; _gteFormCtx = null; gteRenderRight(); }
      );
      listingEl.appendChild(addLocForm);
    }

    col.appendChild(listingEl);
  });
  col.scrollTop = scrollTop;
}

// ── GTE Modal open/close ──────────────────────────────────────────────────────

const GTE_BACKDROP_ID = 'gt-gte-backdrop';

function openGteModal() {
  if (document.getElementById(GTE_MODAL_ID)) return;

  // Backdrop — click outside closes
  const backdrop = document.createElement('div');
  backdrop.id = GTE_BACKDROP_ID;
  backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:2147483638;';
  backdrop.addEventListener('click', closeGteModal);

  // Modal panel — centered
  const modal = document.createElement('div');
  modal.id = GTE_MODAL_ID;
  modal.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
    'width:min(880px,92vw)', 'max-height:82vh',
    'background:#0d0d1f', 'border:1px solid #2a2a4a', 'border-radius:10px',
    'display:flex', 'flex-direction:column', 'overflow:hidden',
    'z-index:2147483639',
    'font-family:system-ui,sans-serif', 'color:#d8d8f0',
    'box-shadow:0 8px 48px rgba(0,0,0,0.8)',
  ].join(';');

  // Sticky header
  const modalHdr = document.createElement('div');
  modalHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1a1a35;flex-shrink:0;';
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:16px;font-weight:700;color:#e0e0f0;';
  titleEl.textContent = 'Guild Trade';
  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;align-items:center;gap:4px;';
  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = '↻ Refresh';
  refreshBtn.style.cssText = 'background:none;border:1px solid #2a2a4a;border-radius:4px;color:#6b6b8a;cursor:pointer;font-size:12px;padding:4px 10px;font-family:inherit;';
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true; refreshBtn.textContent = '↻ Refreshing…';
    _gteDataLoaded = false;
    await gteLoadData(true);
    refreshBtn.disabled = false; refreshBtn.textContent = '↻ Refresh';
  });
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#6b6b8a;cursor:pointer;font-size:18px;padding:4px 8px;font-family:inherit;line-height:1;';
  closeBtn.addEventListener('click', closeGteModal);
  btnGroup.append(refreshBtn, closeBtn);
  modalHdr.append(titleEl, btnGroup);
  modal.appendChild(modalHdr);

  // Scrollable two-column body
  const body = document.createElement('div');
  body.style.cssText = 'display:grid;grid-template-columns:1fr 360px;flex:1;overflow:hidden;';

  const leftCol = document.createElement('div');
  leftCol.id = GTE_LEFT_ID;
  leftCol.style.cssText = 'border-right:1px solid #1a1a35;overflow-y:auto;';

  const rightCol = document.createElement('div');
  rightCol.id = GTE_RIGHT_ID;
  rightCol.style.cssText = 'overflow-y:auto;';

  body.append(leftCol, rightCol);
  modal.appendChild(body);

  document.body.append(backdrop, modal);

  // Esc to close
  if (!_escHandler) {
    _escHandler = (e) => { if (e.key === 'Escape') closeGteModal(); };
    document.addEventListener('keydown', _escHandler);
  }

  // Mark nav link active
  const navA = document.querySelector(`#${GTE_NAV_ID} a`);
  if (navA) navA.classList.add('active');

  gteLoadData();
}

function closeGteModal() {
  document.getElementById(GTE_BACKDROP_ID)?.remove();
  document.getElementById(GTE_MODAL_ID)?.remove();
  _gteFormMode    = null;
  _gteFormCtx     = null;
  _gteExpandedMat = null;
  _gteSearchQ     = '';
  // Remove active state from nav link
  const navA = document.querySelector(`#${GTE_NAV_ID} a`);
  if (navA) navA.classList.remove('active');
}

// ── GTE Navbar injection ──────────────────────────────────────────────────────

let _gteNavInjecting = false;
async function injectGteNavBtn() {
  if (document.getElementById(GTE_NAV_ID)) return;
  if (_gteNavInjecting) return;
  _gteNavInjecting = true;

  try {
    // Only inject if user has an API key set and GTE is enabled
    const { gtExtApiKey } = await chrome.storage.local.get(['gtExtApiKey']);
    if (!gtExtApiKey) return;
    if (!_settings.showGTE) return;

    const navEl = document.querySelector('.navbar-nav')
      ?? document.querySelector('nav ul')
      ?? document.querySelector('[class*="nav-pills"]');
    if (!navEl) return;

    if (document.getElementById(GTE_NAV_ID)) return;

    const li = document.createElement('li');
    li.id = GTE_NAV_ID;
    li.className = 'nav-item';

    const a = document.createElement('a');
    a.className = 'nav-link cursor-pointer py-3';
    a.href = '#';

    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('width', '20');
    iconSvg.setAttribute('height', '16');
    iconSvg.setAttribute('viewBox', '0 0 32 32');
    iconSvg.style.cssText = 'vertical-align:middle;opacity:0.55;margin-right:5px;transition:opacity 0.15s;';
    iconSvg.innerHTML = `
      <rect x="5" y="18" width="4" height="8" rx="1" fill="#b0b0c8"/>
      <line x1="7" y1="14" x2="7" y2="18" stroke="#b0b0c8" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="7" y1="26" x2="7" y2="28" stroke="#b0b0c8" stroke-width="1.5" stroke-linecap="round"/>
      <rect x="12" y="10" width="4" height="10" rx="1" fill="#d0d0e0"/>
      <line x1="14" y1="6" x2="14" y2="10" stroke="#d0d0e0" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="14" y1="20" x2="14" y2="23" stroke="#d0d0e0" stroke-width="1.5" stroke-linecap="round"/>
      <rect x="19" y="14" width="4" height="9" rx="1" fill="#c0c0d4"/>
      <line x1="21" y1="10" x2="21" y2="14" stroke="#c0c0d4" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="21" y1="23" x2="21" y2="26" stroke="#c0c0d4" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M25 5 Q30 10 27 16" stroke="#808098" stroke-width="1" fill="none" stroke-linecap="round"/>
      <circle cx="27" cy="16" r="1.5" fill="#c0c0d4"/>
    `;
    a.appendChild(iconSvg);
    a.appendChild(document.createTextNode('Guild Trade'));

    a.addEventListener('mouseenter', () => { iconSvg.style.opacity = '1'; });
    a.addEventListener('mouseleave', () => { iconSvg.style.opacity = '0.55'; });
    a.addEventListener('click', e => { e.preventDefault(); openGteModal(); });
    li.appendChild(a);
    navEl.appendChild(li);
  } finally {
    _gteNavInjecting = false;
  }
}

// ── GT-Companion + Building panel ─────────────────────────────────────────────

const GT_COMPANION_BAR_ID  = 'gt-companion-bar';
const GT_SLOT_BADGE_CLASS  = 'gt-slot-badge';
const GT_MODAL_TARGET_ID   = 'gt-modal-target';

let _companionTargets   = {}; // { [slotId]: { level, typeId } }
let _companionSnapshots = []; // raw snapshots from last fetch
let _baseSnapshotMap    = {}; // { [baseId]: snapshotId } — persisted in storage
let _companionEnabled   = false; // requires explicit user consent
let _levelLockEnabled   = false; // enabled only when a snapshot is actively applied
let _onLockBtnRefresh   = null;  // set by companion bar to sync lock button state

function _clearCompanionTargets() {
  _companionTargets = {};
  _levelLockEnabled = false;
  chrome.storage.local.set({ gtLevelLock: false });
  _onLockBtnRefresh?.();
  _updateModalTarget();
}

let _buildingKeyHandler = null;
let _buildingModalObs   = null;
let _buildingSlotObs    = null;
let _buildingGridObs    = null;

function _isBuildingModal() {
  const modal = document.querySelector('.modal.show');
  return !!modal?.querySelector('.modal-header .btn-group .input-group-text');
}

function _applyScrapDisableStyle() {
  if (_settings.disableScrap && !document.getElementById('gt-scrap-disable')) {
    const s = document.createElement('style');
    s.id = 'gt-scrap-disable';
    s.textContent = '.modal.show .btn.btn-danger { opacity: 0.35 !important; pointer-events: none !important; }';
    document.head.appendChild(s);
  } else if (!_settings.disableScrap) {
    document.getElementById('gt-scrap-disable')?.remove();
  }
}

let _gtModalTipTimer = null;

function _showModalTip(e, lines) {
  document.getElementById('gt-modal-tip')?.remove();
  clearTimeout(_gtModalTipTimer);
  const mx = e.clientX, my = e.clientY;
  _gtModalTipTimer = setTimeout(() => {
    const tip = document.createElement('div');
    tip.id = 'gt-modal-tip';
    tip.style.cssText = 'position:fixed;z-index:2147483647;background:#0d0d1f;border:1px solid #2a2a4a;border-radius:6px;padding:5px 10px;font-family:system-ui,sans-serif;font-size:11px;color:#b0b0cc;box-shadow:0 4px 16px rgba(0,0,0,0.7);pointer-events:none;white-space:pre;line-height:1.7;';
    tip.textContent = Array.isArray(lines) ? lines.join('\n') : lines;
    document.body.appendChild(tip);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.max(8, Math.min(mx - tw / 2, window.innerWidth - tw - 8));
    const top  = (my + 16 + th > window.innerHeight - 8) ? my - th - 10 : my + 16;
    tip.style.left = left + 'px';
    tip.style.top  = top + 'px';
  }, 250);
}

function _hideModalTip() {
  clearTimeout(_gtModalTipTimer);
  document.getElementById('gt-modal-tip')?.remove();
}

// ── Shared button style for this feature ──────────────────────────────────
// Use _gtBtn(el, variant) to apply. Variants: 'on','off','neutral','muted','target-ok','target-pending'
const _GT_BTN_BASE = 'background:#12122a;border:1px solid;border-radius:4px;cursor:pointer;font-size:11px;font-family:system-ui,sans-serif;font-weight:600;display:inline-flex;align-items:center;justify-content:center;padding:1px 8px;height:24px;flex-shrink:0;transition:border-color 0.15s,color 0.15s,opacity 0.15s;line-height:1;white-space:nowrap;';
const _GT_BTN_VARIANTS = {
  on:             { border: '#22c55e', color: '#4ade80' },
  off:            { border: '#ef4444', color: '#f87171' },
  neutral:        { border: '#2a2a4a', color: '#9090b0' },
  muted:          { border: '#1e1e36', color: '#6b6b8a' },
  'target-ok':    { border: '#22c55e44', color: '#4ade80' },
  'target-pend':  { border: '#3b82f644', color: '#93c5fd' },
};
function _gtBtn(el, variant) {
  const v = _GT_BTN_VARIANTS[variant] ?? _GT_BTN_VARIANTS.neutral;
  el.style.cssText = _GT_BTN_BASE + `border-color:${v.border};color:${v.color};`;
}

const _GT_TOGGLE_BASE = 'display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:400;background:none;border:none;padding:2px 4px;border-radius:3px;color:inherit;opacity:0.75;transition:opacity .15s,background .15s;white-space:nowrap;line-height:1;';
function _styleToggleBtn(btn, on) {
  const dot = btn.querySelector('.gt-toggle-dot');
  if (dot) { dot.style.background = on ? '#22c55e' : '#ef4444'; }
  btn.style.cssText = _GT_TOGGLE_BASE;
}
function _styleHkBtn(btn) { _styleToggleBtn(btn, !_settings.disableHotkeys); }
function _styleScrapBtn(btn) { _styleToggleBtn(btn, _settings.disableScrap); }

function _injectModalButtons(modal) {
  if (modal.querySelector('#gt-modal-btn-wrap')) return;
  const header = modal.querySelector('.modal-header');
  const navGroup = header?.querySelector('.btn-group');
  if (!header || !navGroup) return;

  const wrap = document.createElement('div');
  wrap.id = 'gt-modal-btn-wrap';
  wrap.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-right:8px;';

  // Target level indicator
  const targetEl = document.createElement('span');
  targetEl.id = GT_MODAL_TARGET_ID;
  targetEl.style.cssText = 'display:none;font-size:12px;font-family:inherit;opacity:0.85;white-space:nowrap;';
  wrap.appendChild(targetEl);

  // Divider
  const div1 = document.createElement('span');
  div1.style.cssText = 'width:1px;height:14px;background:rgba(255,255,255,.12);flex-shrink:0;';
  wrap.appendChild(div1);

  // Watch slot counter changes (navigating between slots) and building badge changes (upgrades)
  const slotCounter = header.querySelector('.btn-group .input-group-text');
  _buildingSlotObs = new MutationObserver(() => {
    _updateModalTarget();
    // Re-observe the current slot's badge so live upgrades update the label
    const slotId = _getCurrentSlotId();
    if (slotId) {
      const badge = document.querySelector(`button.btn-building[data-slot-id="${slotId}"] .badge.btn-badge`);
      if (badge && !badge._gtWatched) {
        badge._gtWatched = true;
        new MutationObserver(() => _updateModalTarget()).observe(badge, { characterData: true, childList: true });
      }
    }
  });
  if (slotCounter) {
    _buildingSlotObs.observe(slotCounter, { characterData: true, childList: true, subtree: true });
  }
  // Also watch the building grid container so badge text updates (after upgrade) trigger a refresh
  const buildingGrid = document.querySelector('.btn-building')?.closest('div');
  if (buildingGrid) {
    new MutationObserver(_debounce(() => _updateModalTarget(), 150))
      .observe(buildingGrid, { subtree: true, characterData: true, childList: true });
  }

  const makeToggle = (label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const dot = document.createElement('span');
    dot.className = 'gt-toggle-dot';
    dot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:background .15s;';
    const txt = document.createElement('span');
    txt.textContent = label;
    btn.appendChild(dot);
    btn.appendChild(txt);
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.background = 'rgba(255,255,255,.06)'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.75'; btn.style.background = 'none'; _hideModalTip(); });
    return btn;
  };

  // Hotkeys toggle
  const hkBtn = makeToggle('Hotkeys');
  _styleHkBtn(hkBtn);
  hkBtn.addEventListener('mouseenter', (e) => _showModalTip(e, _settings.disableHotkeys
    ? 'Hotkeys off — click to enable\n\u2190 \u2192 navigate  \u00B7  U upgrade  \u00B7  S scrap  \u00B7  R repair'
    : 'Hotkeys on — click to disable\n\u2190 \u2192 navigate  \u00B7  U upgrade  \u00B7  S scrap  \u00B7  R repair'));
  hkBtn.addEventListener('click', () => {
    _settings.disableHotkeys = !_settings.disableHotkeys;
    saveSettings();
    _styleHkBtn(hkBtn);
    _hideModalTip();
  });

  // Scrap protection toggle
  const scrapBtn = makeToggle('Scrap Lock');
  _styleScrapBtn(scrapBtn);
  scrapBtn.addEventListener('mouseenter', (e) => _showModalTip(e, _settings.disableScrap
    ? 'Scrap protected — click to allow scrapping'
    : 'Scrap unprotected — click to prevent accidental scrapping'));
  scrapBtn.addEventListener('click', () => {
    _settings.disableScrap = !_settings.disableScrap;
    saveSettings();
    _applyScrapDisableStyle();
    _styleScrapBtn(scrapBtn);
    _hideModalTip();
  });

  wrap.appendChild(hkBtn);
  wrap.appendChild(scrapBtn);
  header.insertBefore(wrap, navGroup);

  // Always sync scrap/upgrade state when buttons are injected, regardless of external timing
  _applyScrapDisableStyle();
  setTimeout(_updateModalTarget, 100);
}

function _bindBuildingKeys() {
  if (_buildingKeyHandler) return;
  _buildingKeyHandler = (e) => {
    if (_settings.disableHotkeys) return;
    if (!_isBuildingModal()) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const modal = document.querySelector('.modal.show');
    const navBtns = [...(modal?.querySelectorAll('.modal-header .btn-group .btn-primary.btn-square') ?? [])];
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); navBtns[0]?.click(); break;
      case 'ArrowRight': e.preventDefault(); navBtns[1]?.click(); break;
      case 'u': case 'U': {
        const slotId = _getCurrentSlotId();
        const target = _companionTargets[slotId];
        const hasSnapshot = Object.keys(_companionTargets).length > 0;
        if (target && _levelLockEnabled && hasSnapshot) {
          const cur = parseInt(document.querySelector(`button.btn-building[data-slot-id="${slotId}"] .badge.btn-badge`)?.textContent ?? '0');
          if (cur >= target.level) break;
        }
        modal?.querySelector('.btn.btn-primary.btn-icon-split.w-100')?.click();
        break;
      }
      case 's': case 'S': if (!_settings.disableScrap) modal?.querySelector('.btn.btn-danger')?.click(); break;
      case 'r': case 'R': modal?.querySelector('.btn.btn-success.btn-icon-split')?.click(); break;
    }
  };
  document.addEventListener('keydown', _buildingKeyHandler);
  const modal = document.querySelector('.modal.show');
  if (modal) _injectModalButtons(modal);
}

function _unbindBuildingKeys() {
  if (!_buildingKeyHandler) return;
  document.removeEventListener('keydown', _buildingKeyHandler);
  _buildingKeyHandler = null;
  _buildingSlotObs?.disconnect();
  _buildingSlotObs = null;
  document.getElementById('gt-modal-btn-wrap')?.remove();
  document.getElementById('gt-scrap-disable')?.remove();
  document.getElementById('gt-upgrade-block')?.remove();
  _hideModalTip();
}

// ── Companion: parse + apply ───────────────────────────────────────────────

const GT_COMPANION_URL = 'https://api.gt-companion.com/external/company/base-snapshots';

function _detectCurrentBaseId() {
  const m = window.location.pathname.match(/\/base\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function _isOnBuildingsTab() {
  return /\/base\/\d+/.test(location.pathname) &&
    new URLSearchParams(location.search).get('tab') === 'buildings';
}

function _parseSnapshot(snapshot) {
  const targets = {};
  for (const slot of snapshot.buildingSlotOverrides ?? []) {
    if (slot.status === 2 && slot.building) {
      targets[String(slot.id)] = { level: slot.building.level, typeId: slot.building.typeId };
    }
  }
  return targets;
}

function _applySnapshot(snapshot) {
  _companionTargets = _parseSnapshot(snapshot);
  _levelLockEnabled = true;
  chrome.storage.local.set({ gtLevelLock: true });
  _onLockBtnRefresh?.();
  injectSlotBadges();
  _updateModalTarget();
}

function _fmtSnapshotLabel(s) {
  const date = new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${s.baseName} — ${s.planetName} (${date})`;
}

async function _fetchCompanionSnapshots() {
  if (!_companionEnabled) return;
  const bar = document.getElementById(GT_COMPANION_BAR_ID);
  const setStatus = (msg, err = false) => {
    const el = bar?.querySelector('.gt-cb-status');
    if (el) { el.textContent = msg; el.style.color = err ? '#f87171' : '#9090b0'; }
  };
  setStatus('Fetching…');
  try {
    const apiKey = await getExtApiKey();
    if (!apiKey) throw new Error('No API key — set one in Settings (⚙)');
    const res = await fetch(GT_COMPANION_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const snaps = json.snapshots ?? [];
    if (!snaps.length) throw new Error('No snapshots found');
    _companionSnapshots = snaps;
    _renderSnapshotPicker(bar, snaps);
    setStatus(`${snaps.length} snapshot${snaps.length > 1 ? 's' : ''} loaded`);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function _renderSnapshotPicker(bar, snaps) {
  bar.querySelector('.gt-cb-picker')?.remove();
  // Switch Import → Refresh now that we have data
  const content = bar.querySelector('.gt-cb-content') ?? bar;
  const importBtn = content.querySelector('.gt-cb-import');
  const refreshBtn = content.querySelector('.gt-cb-refresh');
  if (importBtn) importBtn.style.display = 'none';
  if (refreshBtn) refreshBtn.style.display = '';

  const currentBaseId = _detectCurrentBaseId();
  const sorted = [...snaps].sort((a, b) => (b.baseId === currentBaseId) - (a.baseId === currentBaseId));

  const wrap = document.createElement('div');
  wrap.className = 'gt-cb-picker';
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';

  const sel = document.createElement('select');
  sel.style.cssText = 'background:#12122a;border:1px solid #2a2a4a;border-radius:4px;color:#d8d8f0;font-size:11px;padding:2px 5px;height:22px;cursor:pointer;max-width:240px;';

  // Placeholder option
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select snapshot…';
  placeholder.disabled = true;
  sel.appendChild(placeholder);

  sorted.forEach((s) => {
    const isMatch = s.baseId === currentBaseId;
    const opt = document.createElement('option');
    opt.value = String(snaps.indexOf(s));
    opt.textContent = (isMatch ? '● ' : '') + _fmtSnapshotLabel(s);
    if (isMatch) opt.style.color = '#4ade80';
    sel.appendChild(opt);
  });

  // Auto-select stored snapshot and apply, or show placeholder
  const storedId = currentBaseId && _baseSnapshotMap[String(currentBaseId)];
  const storedSnap = storedId && snaps.find(s => s.id === storedId);
  if (storedSnap) {
    sel.value = String(snaps.indexOf(storedSnap));
    _applySnapshot(storedSnap);
  } else {
    sel.value = ''; // show placeholder
  }

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply';
  applyBtn.style.cssText = 'background:#1e1e40;border:1px solid #4f46e5;border-radius:4px;color:#818cf8;font-size:11px;padding:2px 8px;cursor:pointer;flex-shrink:0;';
  applyBtn.addEventListener('click', () => {
    const snap = snaps[Number(sel.value)];
    _applySnapshot(snap);
    if (currentBaseId) {
      _baseSnapshotMap[String(currentBaseId)] = snap.id;
      chrome.storage.local.set({ gtCompanionBaseMap: _baseSnapshotMap });
    }
    const statusEl = bar.querySelector('.gt-cb-status');
    if (statusEl) { statusEl.textContent = `${Object.keys(_companionTargets).length} slots applied`; statusEl.style.color = '#4ade80'; }
  });

  wrap.appendChild(sel);
  wrap.appendChild(applyBtn);
  content.insertBefore(wrap, content.querySelector('.gt-cb-status'));
}

// ── Companion: state helpers ───────────────────────────────────────────────

function _renderCompanionBarState(bar) {
  const panel = bar.querySelector('.gt-cb-panel');
  const barContent = bar.querySelector('.gt-cb-content');
  const activateBtn = bar.querySelector('.gt-cb-activate');
  if (!panel || !barContent || !activateBtn) return;

  if (_companionEnabled) {
    activateBtn.style.display = 'none'; // hidden once active — deactivate lives in Settings
    barContent.style.display = 'flex';
    if (_companionSnapshots.length) {
      _renderSnapshotPicker(bar, _companionSnapshots);
      const statusEl = bar.querySelector('.gt-cb-status');
      if (statusEl) { statusEl.textContent = `${_companionSnapshots.length} snapshots loaded`; statusEl.style.color = '#9090b0'; }
      const importBtn = bar.querySelector('.gt-cb-import');
      const refreshBtn = bar.querySelector('.gt-cb-refresh');
      if (importBtn) importBtn.style.display = 'none';
      if (refreshBtn) refreshBtn.style.display = '';
    }
  } else {
    activateBtn.style.display = '';
    activateBtn.textContent = 'Activate';
    _gtBtn(activateBtn, 'neutral');
    barContent.style.display = 'none';
  }
}

function _showCompanionConsent(bar, onAccept) {
  // Remove any existing consent prompt
  bar.querySelector('.gt-cb-consent')?.remove();
  const panel = bar.querySelector('.gt-cb-panel');
  if (!panel) return;

  const consent = document.createElement('div');
  consent.className = 'gt-cb-consent';
  consent.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0;';

  const msg = document.createElement('span');
  msg.style.cssText = 'color:#9090b0;font-size:11px;flex:1;';
  msg.textContent = 'Your API key will be used to call all base snapshots from GT-Companion.';
  consent.appendChild(msg);

  const acceptBtn = document.createElement('button');
  acceptBtn.textContent = 'Accept & Activate';
  _gtBtn(acceptBtn, 'on');
  acceptBtn.addEventListener('click', () => { consent.remove(); onAccept(); });
  consent.appendChild(acceptBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  _gtBtn(cancelBtn, 'neutral');
  cancelBtn.addEventListener('click', () => consent.remove());
  consent.appendChild(cancelBtn);

  panel.appendChild(consent);
}

// ── Companion: import bar ──────────────────────────────────────────────────

function injectCompanionBar() {
  if (document.getElementById(GT_COMPANION_BAR_ID)) return;
  const firstBtn = document.querySelector('button.btn-building[data-slot-id]');
  if (!firstBtn) return;
  const cardBody = firstBtn.closest('.card-body');
  if (!cardBody?.parentElement) return;

  // Load persisted state
  chrome.storage.local.get(['gtCompanionBaseMap', 'gtCompanionEnabled', 'gtLevelLock'], ({ gtCompanionBaseMap, gtCompanionEnabled, gtLevelLock }) => {
    _baseSnapshotMap = gtCompanionBaseMap ?? {};
    _companionEnabled = gtCompanionEnabled ?? false;
    const hasSnapshot = Object.keys(_companionTargets).length > 0;
    _levelLockEnabled = hasSnapshot && (gtLevelLock !== false);
    _renderCompanionBarState(bar);
  });

  // ── Outer wrapper ───────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = GT_COMPANION_BAR_ID;
  bar.style.cssText = 'font-family:system-ui,sans-serif;font-size:11px;margin-bottom:8px;';

  // ── Main content panel ──────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'gt-cb-panel';
  panel.style.cssText = 'background:#0d0d1f;border:1px solid #1a1a30;border-bottom:none;padding:6px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;overflow:hidden;transition:max-height 0.25s ease,padding 0.25s ease;max-height:80px;';

  // Title + tooltip — always in panel left
  const titleWrap = document.createElement('div');
  titleWrap.style.cssText = 'display:inline-flex;align-items:center;gap:5px;flex-shrink:0;';

  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'color:#6366f1;font-weight:700;letter-spacing:0.03em;';
  titleEl.textContent = 'GT-Companion';

  const helpBtn = document.createElement('span');
  helpBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid #4a4a6a;color:#6b6b8a;font-size:9px;font-weight:700;cursor:default;flex-shrink:0;line-height:1;';
  helpBtn.textContent = '?';
  helpBtn.addEventListener('mouseenter', (e) => {
    _showModalTip(e, [
      'Load existing base snapshots from GT-Companion to help with base design and leveling.',
      'Level Lock will cap the maximum upgrade on that building slot to prevent accidents.',
      '',
      'You must have \'Cross-Device Sync\' enabled in GT-Companion to fetch your base plan snapshots.',
    ]);
  });
  helpBtn.addEventListener('mouseleave', _hideModalTip);

  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(helpBtn);
  panel.appendChild(titleWrap);

  // ── Lip tab — sits below panel, right-aligned, always visible ──────────
  const lip = document.createElement('div');
  lip.style.cssText = 'display:flex;justify-content:flex-end;';

  const lipBtn = document.createElement('div');
  lipBtn.style.cssText = 'display:inline-flex;align-items:center;background:#0d0d1f;border:1px solid #1a1a30;border-top:none;border-radius:0 0 6px 6px;padding:2px 10px 3px;cursor:pointer;user-select:none;';

  const lipArrow = document.createElement('span');
  lipArrow.style.cssText = 'color:#6b6b8a;font-size:9px;line-height:1;transition:color 0.15s;';
  lipArrow.textContent = '▲';

  lipBtn.appendChild(lipArrow);
  lip.appendChild(lipBtn);
  lipBtn.addEventListener('mouseenter', () => { lipArrow.style.color = '#9090b0'; });
  lipBtn.addEventListener('mouseleave', () => { lipArrow.style.color = '#6b6b8a'; });

  let _barCollapsed = false;
  const toggleCollapse = () => {
    _barCollapsed = !_barCollapsed;
    if (_barCollapsed) {
      panel.style.maxHeight = '0';
      panel.style.padding = '0 10px';
      lipArrow.textContent = '▼';
    } else {
      panel.style.maxHeight = '80px';
      panel.style.padding = '6px 10px';
      lipArrow.textContent = '▲';
    }
  };
  lipBtn.addEventListener('click', toggleCollapse);

  // ── Activation toggle ───────────────────────────────────────────────────
  const activateBtn = document.createElement('button');
  activateBtn.className = 'gt-cb-activate';
  activateBtn.textContent = 'Activate';
  _gtBtn(activateBtn, 'neutral');
  activateBtn.addEventListener('click', () => {
    if (_companionEnabled) return; // deactivation handled in Settings panel
    _showCompanionConsent(bar, () => {
      _companionEnabled = true;
      chrome.storage.local.set({ gtCompanionEnabled: true });
      _renderCompanionBarState(bar);
    });
  });
  panel.appendChild(activateBtn);

  // ── Content area (only visible when activated) ──────────────────────────
  const barContent = document.createElement('div');
  barContent.className = 'gt-cb-content';
  barContent.style.cssText = 'display:none;align-items:center;gap:8px;flex:1;flex-wrap:wrap;';

  const doFetch = (btn) => {
    btn.disabled = true; btn.style.opacity = '0.5';
    _fetchCompanionSnapshots().finally(() => { btn.disabled = false; btn.style.opacity = ''; });
  };

  const importBtn = document.createElement('button');
  importBtn.className = 'gt-cb-import';
  importBtn.textContent = '⬇ Import';
  _gtBtn(importBtn, 'neutral');
  importBtn.addEventListener('click', () => doFetch(importBtn));
  barContent.appendChild(importBtn);

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'gt-cb-refresh';
  refreshBtn.textContent = '↻';
  refreshBtn.title = 'Re-fetch snapshots';
  _gtBtn(refreshBtn, 'muted');
  refreshBtn.style.display = 'none';
  refreshBtn.addEventListener('click', () => doFetch(refreshBtn));
  barContent.appendChild(refreshBtn);

  const statusEl = document.createElement('span');
  statusEl.className = 'gt-cb-status';
  statusEl.style.cssText = 'color:#6b6b8a;font-size:11px;flex:1;';
  statusEl.textContent = 'No targets loaded';
  barContent.appendChild(statusEl);

  // Level Lock toggle
  const lockBtn = document.createElement('button');
  const _updateLockBtn = () => {
    lockBtn.textContent = _levelLockEnabled ? 'Lvl 🔒 On' : 'Lvl 🔓 Off';
    _gtBtn(lockBtn, _levelLockEnabled ? 'on' : 'off');
  };
  _onLockBtnRefresh = _updateLockBtn;
  lockBtn.addEventListener('click', () => {
    _levelLockEnabled = !_levelLockEnabled;
    chrome.storage.local.set({ gtLevelLock: _levelLockEnabled });
    _updateLockBtn();
    _updateModalTarget(); // re-evaluate upgrade block state
  });
  _updateLockBtn();
  barContent.appendChild(lockBtn);

  const _clearHover = (el, on) => { el.style.color = on ? '#f87171' : '#6b6b8a'; el.style.borderColor = on ? '#6b2a2a' : '#1e1e36'; };

  const clearBtn = document.createElement('button');
  clearBtn.className = 'gt-cb-clear';
  clearBtn.textContent = 'Clear Current Overlay';
  _gtBtn(clearBtn, 'muted');
  clearBtn.addEventListener('mouseenter', () => _clearHover(clearBtn, true));
  clearBtn.addEventListener('mouseleave', () => _clearHover(clearBtn, false));
  clearBtn.addEventListener('click', () => {
    const baseId = _detectCurrentBaseId();
    _clearCompanionTargets();
    if (baseId) {
      delete _baseSnapshotMap[String(baseId)];
      chrome.storage.local.set({ gtCompanionBaseMap: _baseSnapshotMap });
    }
    injectSlotBadges();
    const sel = bar.querySelector('.gt-cb-picker select');
    if (sel) sel.value = '';
    statusEl.textContent = 'Overlay cleared';
    statusEl.style.color = '#6b6b8a';
  });
  barContent.appendChild(clearBtn);

  const clearAllBtn = document.createElement('button');
  clearAllBtn.textContent = 'Clear All Overlays';
  clearAllBtn.title = 'Remove overlays for all bases';
  _gtBtn(clearAllBtn, 'muted');
  clearAllBtn.addEventListener('mouseenter', () => _clearHover(clearAllBtn, true));
  clearAllBtn.addEventListener('mouseleave', () => _clearHover(clearAllBtn, false));
  clearAllBtn.addEventListener('click', () => {
    _clearCompanionTargets();
    _baseSnapshotMap = {};
    chrome.storage.local.set({ gtCompanionBaseMap: {} });
    injectSlotBadges();
    _updateModalTarget();
    const sel = bar.querySelector('.gt-cb-picker select');
    if (sel) sel.value = '';
    statusEl.textContent = 'All overlays cleared';
    statusEl.style.color = '#6b6b8a';
  });
  barContent.appendChild(clearAllBtn);

  panel.appendChild(barContent);
  bar.appendChild(panel);
  bar.appendChild(lip);
  cardBody.parentElement.insertBefore(bar, cardBody);
  bar.style.marginBottom = '0'; // lip provides the bottom spacing visually

  // Render initial state once storage loads (via _renderCompanionBarState)
}

// ── Slot badge overlay ────────────────────────────────────────────────────

function _getBuildingTypeId(btn) {
  // Extract from SVG xlink:href hash e.g. "#ColonyBarracks" → sanitized name
  // Then match against gamedata buildings by sanitized name
  const use = btn.querySelector('use');
  const href = use?.getAttribute('xlink:href') ?? use?.getAttribute('href') ?? '';
  const spriteId = href.split('#')[1] ?? '';
  if (!spriteId || !_gamedata) return null;
  const sanitize = s => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const match = _gamedata.buildings?.find(b => sanitize(b.name) === sanitize(spriteId));
  return match?.id ?? null;
}

function _getBuildingTypeName(typeId) {
  return _gamedata?.buildings?.find(b => b.id === typeId)?.name ?? `Type ${typeId}`;
}

function injectSlotBadges() {
  document.querySelectorAll('button.btn-building[data-slot-id]').forEach(btn => {
    btn.querySelector(`.${GT_SLOT_BADGE_CLASS}`)?.remove();
    const target = _companionTargets[btn.dataset.slotId];
    if (!target) return;

    const currentLvl = parseInt(btn.querySelector('.badge.btn-badge')?.textContent ?? '0');
    const currentTypeId = _getBuildingTypeId(btn);
    const typeMatch = currentTypeId === null || currentTypeId === target.typeId;
    const levelMatch = currentLvl >= target.level;

    let bg, color, text;
    if (!typeMatch) {
      // Wrong building type — show what's needed
      bg = '#3b1a1a'; color = '#f87171';
      text = `→ ${_getBuildingTypeName(target.typeId)}`;
    } else if (!levelMatch) {
      // Right type, wrong level
      bg = '#1e3a5f'; color = '#93c5fd';
      text = `Lv.${currentLvl} → ${target.level}`;
    } else {
      // All good
      bg = '#14532d'; color = '#4ade80';
      text = `✓ Lv.${target.level}`;
    }

    const badge = document.createElement('span');
    badge.className = GT_SLOT_BADGE_CLASS;
    badge.style.cssText = `position:absolute;bottom:2px;right:2px;background:${bg};color:${color};font-size:8px;font-weight:700;border-radius:3px;padding:0 3px;line-height:14px;pointer-events:none;z-index:2;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    badge.textContent = text;
    btn.style.position = 'relative';
    btn.appendChild(badge);
  });
}

// ── Modal target indicator ────────────────────────────────────────────────

function _getCurrentSlotId() {
  return document.querySelector('.modal.show .modal-header .btn-group .input-group-text')?.textContent?.trim();
}

function _applyUpgradeBlock(block) {
  let s = document.getElementById('gt-upgrade-block');
  const hasSnapshot = Object.keys(_companionTargets).length > 0;
  if (block && _levelLockEnabled && hasSnapshot && !s) {
    s = document.createElement('style');
    s.id = 'gt-upgrade-block';
    s.textContent = '.modal.show .btn.btn-primary.btn-icon-split.w-100 { opacity:0.4 !important; pointer-events:none !important; }';
    document.head.appendChild(s);
  } else if (!block || !_levelLockEnabled || !hasSnapshot) {
    s?.remove();
  }
}

function _updateModalTarget() {
  const el = document.getElementById(GT_MODAL_TARGET_ID);
  if (!el) return;
  const slotId = _getCurrentSlotId();
  const target = slotId ? _companionTargets[slotId] : null;
  if (!target) {
    el.style.display = 'none';
    _applyUpgradeBlock(false);
    return;
  }
  const currentLvl = parseInt(document.querySelector(`button.btn-building[data-slot-id="${slotId}"] .badge.btn-badge`)?.textContent ?? '0');
  const done = currentLvl >= target.level;
  el.style.display = '';
  if (done) {
    el.textContent = `✓ Lv.${target.level} / ${target.level}`;
    el.style.color = '#4ade80';
  } else {
    el.textContent = `Lv.${currentLvl} / ${target.level}`;
    el.style.color = '#9090b0';
  }
  _applyUpgradeBlock(done);
}

let _companionBarBaseId = null; // baseId the bar was last injected for

function _onUrlChange() {
  if (_isOnBuildingsTab()) {
    const baseId = _detectCurrentBaseId();
    // Force re-inject if base changed (different planet/base)
    if (baseId !== _companionBarBaseId) {
      document.getElementById(GT_COMPANION_BAR_ID)?.remove();
      _clearCompanionTargets();
      _companionBarBaseId = baseId;
    }
    if (document.querySelector('button.btn-building[data-slot-id]')) {
      injectCompanionBar();
      injectSlotBadges();
    } else {
      const obs = new MutationObserver(() => {
        if (document.querySelector('button.btn-building[data-slot-id]')) {
          obs.disconnect();
          injectCompanionBar();
          injectSlotBadges();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  } else {
    document.getElementById(GT_COMPANION_BAR_ID)?.remove();
    _clearCompanionTargets();
    _companionBarBaseId = null;
  }
}

function watchBuildingGrid() {
  if (_buildingGridObs) return;
  const _origPush    = history.pushState.bind(history);
  const _origReplace = history.replaceState.bind(history);
  history.pushState    = (...args) => { _origPush(...args);    _onUrlChange(); };
  history.replaceState = (...args) => { _origReplace(...args); _onUrlChange(); };
  window.addEventListener('popstate', _onUrlChange);
  // Fallback: poll for URL changes the game makes outside pushState/replaceState
  let _lastHref = location.href;
  setInterval(() => { if (location.href !== _lastHref) { _lastHref = location.href; _onUrlChange(); } }, 300);
  _onUrlChange(); // check on initial load
  _buildingGridObs = true;
}

function watchBuildingModal() {
  if (_buildingModalObs) return;
  _buildingModalObs = new MutationObserver(() => {
    if (document.body.classList.contains('modal-open')) {
      // Retry until _isBuildingModal() is true (slot counter may not render immediately)
      let attempts = 0;
      const tryBind = () => {
        if (_isBuildingModal()) {
          _bindBuildingKeys();
        } else if (++attempts < 10) {
          setTimeout(tryBind, 100);
        }
      };
      setTimeout(tryBind, 100);
    } else {
      _unbindBuildingKeys();
    }
  });
  _buildingModalObs.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: false });
}

// ── Flight modal injection ─────────────────────────────────────────────────────

let _flightModalObs = null;

function watchFlightModal() {
  if (_flightModalObs) return;
  _flightModalObs = new MutationObserver(() => {
    if (!document.body.classList.contains('modal-open')) return;
    setTimeout(() => {
      const modal = document.querySelector('.modal.show');
      if (!modal || !modal.querySelector('button[data-btn-start-flight]')) return;
      if (modal.querySelector('#gt-fi')) return;
      _setupFlightModalInjection(modal);
    }, 300);
  });
  _flightModalObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

async function _setupFlightModalInjection(modal) {
  if (!_companyData) {
    const fresh = await requestGTLocalAPI('getMyCompany');
    if (fresh?.id) _companyData = { ...fresh, perks: _companyData?.perks };
  }
  if (!_priceMap)    await fetchMatPrices();
  if (!_avgPriceMap) await fetchAvgPrices();
  if (!_guildData)   await fetchGuildData();

  const gamedata = _loadedHeaderGamedata;
  if (!gamedata || !_companyData) return;

  const company         = _companyData;
  const ships           = company.ships ?? [];
  const emitterMap      = new Map((gamedata.shipEmitters ?? []).map(e => [e.type, e]));
  const reactorMap      = new Map((gamedata.shipReactors ?? []).map(r => [r.type, r]));
  const flightPerks     = calcFlightPerks(company, gamedata.perks);
  const fuelSavingMult  = 1 + flightPerks.fuelSavingPct  / 100;
  const degradationMult = 1 + flightPerks.degradationPct / 100;
  const totalSpeedMult  =
    companyStartingBonus(company.fDate) *
    (1 + ((_guildData?.projects ?? []).find(p => p.type === 3)?.level ?? 0) * 0.03) *
    (1 + flightPerks.speedPct / 100);
  const REPAIR_KIT_MAT_ID = 113;

  const inject = () => _injectGTFlightHints(
    modal, ships, emitterMap, reactorMap,
    flightPerks, fuelSavingMult, degradationMult, totalSpeedMult, REPAIR_KIT_MAT_ID
  );

  inject();

  const cardObs = new MutationObserver(_debounce(() => {
    if (!modal.isConnected) { cardObs.disconnect(); return; }
    if (!modal.querySelector('#gt-fi')) inject();
  }, 200));
  cardObs.observe(modal.querySelector('.modal-body') ?? modal, { childList: true, subtree: true });
}

function _injectGTFlightHints(modal, ships, emitterMap, reactorMap,
                               flightPerks, fuelSavingMult, degradationMult, totalSpeedMult, REPAIR_KIT_MAT_ID) {
  const slider = modal.querySelector('input#customRange1');
  if (!slider) return;

  // ── Indicator bars — vertical rectangles overlaid on the slider track ──────────
  // Wrap the slider in a relative container so indicators can be absolutely positioned
  const sliderWrap = document.createElement('div');
  sliderWrap.id = 'gt-fi';
  sliderWrap.style.cssText = 'position:relative;';
  slider.parentNode.insertBefore(sliderWrap, slider);
  sliderWrap.appendChild(slider);

  const mkBar = (col) => {
    const d = document.createElement('span');
    d.style.cssText = [
      'position:absolute;top:50%;transform:translate(-50%,-50%);',
      `width:8px;height:16px;border-radius:2px;background:${col};`,
      'cursor:pointer;opacity:0;transition:opacity .15s;pointer-events:none;',
      'z-index:10;',
    ].join('');
    sliderWrap.appendChild(d);
    let _tipEl = null, _tipTimer = null;
    d.addEventListener('mouseenter', (e) => {
      _tipTimer = setTimeout(() => {
        _tipEl = document.createElement('div');
        _tipEl.style.cssText = 'position:fixed;z-index:2147483647;background:#1a1a2e;border:1px solid #3a3a5a;border-radius:4px;padding:3px 8px;font-size:11px;color:#c0c0da;pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5);';
        _tipEl.textContent = d.dataset.gtTip ?? '';
        document.body.appendChild(_tipEl);
        _tipEl.style.left = Math.min(e.clientX + 10, window.innerWidth - _tipEl.offsetWidth - 6) + 'px';
        _tipEl.style.top  = (e.clientY - _tipEl.offsetHeight - 8) + 'px';
      }, 500);
    });
    d.addEventListener('mousemove', (e) => {
      if (_tipEl) {
        _tipEl.style.left = Math.min(e.clientX + 10, window.innerWidth - _tipEl.offsetWidth - 6) + 'px';
        _tipEl.style.top  = (e.clientY - _tipEl.offsetHeight - 8) + 'px';
      }
    });
    d.addEventListener('mouseleave', () => { clearTimeout(_tipTimer); _tipEl?.remove(); _tipEl = null; });
    return d;
  };
  const greenDot = mkBar('#22c55e'); greenDot.dataset.gtTip = 'Cheapest';
  const blueDot  = mkBar('#60a5fa'); blueDot.dataset.gtTip  = 'Best';

  // ── Cost rows — injected after the native "Fuel used" row ─────────────────────
  const allRows = [...modal.querySelectorAll('.card-body .row')];
  const fuelRow = allRows.find(r => r.querySelector('.col-4')?.textContent?.trim() === 'Fuel used');
  if (!fuelRow) return;

  const mkCostRow = (id, labelText) => {
    const r = document.createElement('div');
    r.id = id;
    r.className = 'row';
    r.innerHTML = `<div class="col-4 caption-lr-start">${labelText}</div><div class="col"><span class="text-body-tertiary">-</span></div>`;
    return r;
  };
  const fuelCostRow   = mkCostRow('gt-fuel-row',   'Fuel cost');
  const repairCostRow = mkCostRow('gt-repair-row', 'Repair cost');
  const totalCostRow  = mkCostRow('gt-total-row',  'Est. total cost');
  fuelRow.after(totalCostRow);
  fuelRow.after(repairCostRow);
  fuelRow.after(fuelCostRow);
  const setCostRowsVisible = (v) => {
    [fuelCostRow, repairCostRow, totalCostRow].forEach(r => r.style.display = v ? '' : 'none');
  };
  setCostRowsVisible(_settings.showFlightCosts);
  const fuelValEl   = fuelCostRow.querySelector('span');
  const repairValEl = repairCostRow.querySelector('span');
  const totalValEl  = totalCostRow.querySelector('span');

  // ── Shared state reader ────────────────────────────────────────────────────────
  const readState = () => {
    const checkedInput = modal.querySelector('input.btn-check[name="btnradioinfo"]:checked');
    const shipLabel    = checkedInput && modal.querySelector(`label[for="${checkedInput.id}"]`);
    const ship         = ships.find(s => String(s.id) === String(shipLabel?.dataset?.shipId));
    const distRow      = allRows.find(r => r.querySelector('.col-4')?.textContent?.trim() === 'Distance');
    const distMatch    = distRow?.querySelector('.col')?.textContent?.trim().match(/([\d.]+)\s*ly/);
    const dist         = distMatch ? parseFloat(distMatch[1]) : null;
    const cargoEl      = modal.querySelector('span.transition-bg-eout');
    const cargoWeight  = cargoEl ? parseFloat(cargoEl.textContent.replace(/,/g, '')) || 0 : 0;
    return { ship, dist, cargoWeight };
  };

  const buildOpts = (ship) => {
    const bp      = ship.blueprint;
    const emitter = emitterMap.get(bp.emitterType);
    const reactor = reactorMap.get(bp.reactorType);
    if (!emitter || !reactor) return null;
    const cfg = calcShipConfig(bp, emitter, reactor);
    return {
      emitter, reactor,
      opts: {
        fuelSavingMult, degradationMult,
        fuelPrice:       effectivePrice(reactor.fuelId),
        repairKitPrice:  effectivePrice(REPAIR_KIT_MAT_ID),
        repairKitsTotal: cfg.weightEmpty / 10,
        effectiveCargo:  bp.cargoCapacity * (1 + flightPerks.cargoCapPct / 100),
      },
    };
  };

  const hide = () => {
    [greenDot, blueDot].forEach(d => { d.style.opacity = '0'; d.style.pointerEvents = 'none'; });
    fuelValEl.textContent   = '-'; fuelValEl.className   = 'text-body-tertiary';
    repairValEl.textContent = '-'; repairValEl.className = 'text-body-tertiary';
    totalValEl.textContent  = '-'; totalValEl.className  = 'text-body-tertiary';
  };

  // ── recalc ─────────────────────────────────────────────────────────────────────
  const recalc = () => {
    const { ship, dist, cargoWeight } = readState();
    if (!ship || !dist) { hide(); return; }

    const built = buildOpts(ship);
    if (!built) { hide(); return; }
    const { emitter, reactor, opts } = built;

    const optPF   = findOptimalFlightPF(dist, ship, cargoWeight, emitter, reactor, totalSpeedMult, opts);
    const cheapPF = findCheapestFlightPF(dist, ship, cargoWeight, emitter, reactor, totalSpeedMult, opts);
    const currentPF = Math.max(0.20, Math.min(1.0, parseInt(slider.value, 10) / 100));
    const res     = calcFlight(dist, ship, cargoWeight, emitter, reactor, totalSpeedMult, currentPF, opts);

    const fuelCost   = res.fuelUsed * opts.fuelPrice;
    const repairCost = Math.ceil(opts.repairKitsTotal * res.condWear) * opts.repairKitPrice;
    const hasFuel    = (ship.fuel ?? 0) >= Math.ceil(res.fuelUsed);

    const posLeft = pf => {
      const fraction = (pf * 100 - 20) / 80;
      const w = slider.getBoundingClientRect().width;
      const thumbR = parseFloat(getComputedStyle(slider).getPropertyValue('--bs-form-range-thumb-width') || '16') / 2;
      if (w > 0) return `${((thumbR + fraction * (w - 2 * thumbR)) / w * 100).toFixed(2)}%`;
      return `${(fraction * 100).toFixed(1)}%`;
    };

    // green = cheapest, blue = best (optimal)
    greenDot.style.left          = posLeft(cheapPF);
    greenDot.style.opacity       = '1';
    greenDot.style.pointerEvents = 'auto';

    const sameSpot = Math.abs(optPF - cheapPF) < 0.015;
    blueDot.style.display        = sameSpot ? 'none' : '';
    blueDot.style.left           = posLeft(optPF);
    blueDot.style.opacity        = '1';
    blueDot.style.pointerEvents  = 'auto';

    const totalCost = fuelCost + repairCost;
    fuelValEl.textContent   = opts.fuelPrice      > 0 ? '$' + Math.round(fuelCost).toLocaleString()   : '-';
    fuelValEl.className     = hasFuel ? '' : 'text-danger fw-semibold';
    repairValEl.textContent = opts.repairKitPrice  > 0 ? '$' + Math.round(repairCost).toLocaleString() : '-';
    repairValEl.className   = '';
    totalValEl.textContent  = totalCost > 0 ? '$' + Math.round(totalCost).toLocaleString() : '-';
    totalValEl.className    = hasFuel ? '' : 'text-danger fw-semibold';
  };

  // ── Dot click handlers ─────────────────────────────────────────────────────────
  const applyDot = (findFn) => {
    const { ship, dist, cargoWeight } = readState();
    if (!ship || !dist) return;
    const built = buildOpts(ship);
    if (!built) return;
    const { emitter, reactor, opts } = built;
    const pf = findFn(dist, ship, cargoWeight, emitter, reactor, totalSpeedMult, opts);
    slider.value = String(Math.round(pf * 100));
    slider.dispatchEvent(new Event('input',  { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(recalc, 60);
  };

  greenDot.addEventListener('click', () => applyDot(findCheapestFlightPF));
  blueDot.addEventListener('click',  () => applyDot(findOptimalFlightPF));

  // ── Event hooks ───────────────────────────────────────────────────────────────
  recalc();

  modal.querySelectorAll('input.btn-check[name="btnradioinfo"]')
    .forEach(inp => inp.addEventListener('change', recalc));
  slider.addEventListener('input', recalc);
  modal.querySelectorAll('.dropdown-menu .dropdown-item')
    .forEach(item => item.addEventListener('click', () => setTimeout(recalc, 150)));

  // Watch the Distance row for game-side updates (destination typed/selected)
  const distRow = allRows.find(r => r.querySelector('.col-4')?.textContent?.trim() === 'Distance');
  if (distRow) {
    new MutationObserver(_debounce(recalc, 80))
      .observe(distRow, { subtree: true, characterData: true, childList: true });
  }
}

// ── Contracts page — pinnable active contracts ────────────────────────────────

function _injectContractPins() {
  if (!document.getElementById('gt-contracts-style')) {
    const s = document.createElement('style');
    s.id = 'gt-contracts-style';
    s.textContent = '.gt-pin-btn{opacity:.2;color:#f59e0b!important;transition:opacity .15s;} .gt-pin-btn.gt-starred{opacity:1!important;} .gt-pin-btn:not(.gt-starred):hover{opacity:.55!important;} .gt-pin-btn.gt-starred:hover{opacity:.8!important;}';
    document.head.appendChild(s);
  }
  const table = document.querySelector('table.table-hover.mb-0');
  if (!table) return;

  const activeTh = [...table.querySelectorAll('th')]
    .find(th => th.textContent.trim() === 'Active Contracts');
  const activeTbody = activeTh?.closest('thead')?.nextElementSibling;
  if (!activeTbody || activeTbody.tagName !== 'TBODY') return;

  const pinned = _getPinnedContracts();
  const rows   = [...activeTbody.querySelectorAll('tr')];

  // Stamp original DOM index on first visit so we can restore order on unpin
  rows.forEach((tr, i) => { if (!tr.dataset.gtOrigIdx) tr.dataset.gtOrigIdx = i; });

  // Prune stale keys for contracts no longer in the active list
  const currentKeys = new Set(rows.map(_contractRowKey));
  let changed = false;
  for (const k of pinned) { if (!currentKeys.has(k)) { pinned.delete(k); changed = true; } }
  if (changed) _setPinnedContracts(pinned);

  const setPinState = (btn, starred) => {
    btn.textContent = '★';
    btn.title       = starred ? 'Unpin' : 'Pin to top';
    btn.classList.toggle('gt-starred', starred);
  };

  for (const tr of rows) {
    const key      = _contractRowKey(tr);
    const isPinned = pinned.has(key);

    // Update existing star state if already injected
    const existing = tr.querySelector('.gt-pin-btn');
    if (existing) { setPinState(existing, isPinned); continue; }

    const firstTd = tr.querySelector('td');
    if (!firstTd) continue;

    // Anchor star absolutely to top-left of the first cell — no layout impact
    firstTd.style.position = 'relative';

    const pinBtn = document.createElement('button');
    pinBtn.className     = 'gt-pin-btn';
    pinBtn.style.cssText = 'position:absolute;top:2px;left:2px;background:none;border:none;cursor:pointer;padding:0;font-size:10px;line-height:1;transition:opacity .15s;z-index:1;';
    setPinState(pinBtn, isPinned);

    pinBtn.addEventListener('click', e => {
      e.stopPropagation();
      const p = _getPinnedContracts();
      if (p.has(key)) p.delete(key); else p.add(key);
      _setPinnedContracts(p);
      _injectContractPins();
    });

    firstTd.appendChild(pinBtn);
  }

  // Sort: pinned rows first, unpinned rows restored to original DOM order.
  // Use insertBefore with a position check so only rows that are actually out of
  // place get moved — avoids unnecessary DOM mutations that cause button flashes.
  const sorted = [
    ...rows.filter(tr => pinned.has(_contractRowKey(tr))),
    ...rows.filter(tr => !pinned.has(_contractRowKey(tr)))
          .sort((a, b) => parseInt(a.dataset.gtOrigIdx, 10) - parseInt(b.dataset.gtOrigIdx, 10)),
  ];
  sorted.forEach((tr, i) => {
    if (activeTbody.children[i] !== tr) {
      activeTbody.insertBefore(tr, activeTbody.children[i] ?? null);
    }
  });
}

let _contractsObs = null;
function watchContractsPage() {
  if (_contractsObs) return;
  let _lastActiveTbody = null;

  const tryInject = () => {
    if (!location.href.includes('/exchange')) return;
    const th = [...document.querySelectorAll('th')]
      .find(th => th.textContent.trim() === 'Active Contracts');
    const tbody = th?.closest('thead')?.nextElementSibling ?? null;
    if (!tbody || tbody.tagName !== 'TBODY') return;
    if (tbody === _lastActiveTbody) return;
    _lastActiveTbody = tbody;
    _injectContractPins();

    // Re-inject only if the game adds fresh rows (not our own sort reorder)
    new MutationObserver(_debounce(() => {
      const hasNew = [...tbody.querySelectorAll('tr')].some(tr => !tr.querySelector('.gt-pin-btn'));
      if (!hasNew) return;
      _lastActiveTbody = null;
      _injectContractPins();
    }, 300)).observe(tbody, { childList: true });
  };

  _contractsObs = new MutationObserver(_debounce(tryInject, 200));
  _contractsObs.observe(document.body, { childList: true, subtree: true });

  // Catch SPA pushState navigation
  const _origPush = history.pushState.bind(history);
  history.pushState = (...a) => { _origPush(...a); setTimeout(tryInject, 400); };
  window.addEventListener('popstate', () => setTimeout(tryInject, 400));

  tryInject();
}

function watchGteNav() {
  injectGteNavBtn();
  if (_gteNavObs) return;
  _gteNavObs = new MutationObserver(() => {
    if (!document.getElementById(GTE_NAV_ID)) injectGteNavBtn();
  });
  _gteNavObs.observe(document.body, { childList: true, subtree: true });
}
