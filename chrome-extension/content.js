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

  // Try Local API
  const company = await requestGTLocalAPI('getMyCompany');
  if (Number.isInteger(company?.id) && company.id > 0) {
    try {
      const r = await fetch(`${GT_API}/public/company/${company.id}/detail`);
      if (r.ok) {
        const detail = await r.json();
        const gTag = detail.gTag ?? detail.guild_tag ?? '';
        if (gTag) {
          const companyName = company.name ?? '';
          chrome.storage.local.set({ gTag, companyName, gTagTs: Date.now() });
          return { gTag, companyName };
        }
      }
    } catch {}
  }

  // Fallback: Extended API key
  const { gtExtApiKey } = await chrome.storage.local.get(['gtExtApiKey']);
  if (!gtExtApiKey) return null;
  try {
    const r1 = await fetch(`${GT_API}/public/company?apikey=${encodeURIComponent(gtExtApiKey)}`);
    if (!r1.ok) return null;
    const co = await r1.json();
    const cid = co.id ?? co.cId;
    if (!Number.isInteger(cid) || cid <= 0) return null;
    const r2 = await fetch(`${GT_API}/public/company/${cid}/detail`);
    if (!r2.ok) return null;
    const detail = await r2.json();
    const gTag = detail.gTag ?? detail.guild_tag ?? '';
    if (!gTag) return null;
    const companyName = co.name ?? co.companyName ?? '';
    chrome.storage.local.set({ gTag, companyName, gTagTs: Date.now() });
    return { gTag, companyName };
  } catch { return null; }
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

      span.addEventListener('mouseenter', () => showTooltip(span, l));
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

const GT_HEADER_ID   = 'gt-prod-header';
const GT_DETAIL_ID   = 'gt-prod-detail';
const GT_SPACER_ID   = 'gt-prod-spacer';
const GT_SETTINGS_ID = 'gt-prod-settings';
const GT_TOAST_ID    = 'gt-prod-toast';
const GT_TAB_ID      = 'gt-prod-tab';
const GT_CASH_ID     = 'gt-cash-panel';
const GT_SUMMARY_ID  = 'gt-summary-panel';
const BASES_CACHE_TTL = 5 * 60 * 1000; // 5 min

// ── SVG sprite / material icons ───────────────────────────────────────────────

const GT_SPRITE_ID = 'gt-sprite-container';
let _spriteLoaded  = false;

async function loadSprite() {
  if (_spriteLoaded || document.getElementById(GT_SPRITE_ID)) { _spriteLoaded = true; return; }
  try {
    const resp = await fetch('https://galactic-track.com/api/gamedata/sprite');
    if (!resp.ok) return;
    const svg  = await resp.text();
    const wrap = document.createElement('div');
    wrap.id = GT_SPRITE_ID;
    wrap.style.cssText = 'display:none;position:absolute;width:0;height:0;overflow:hidden;';
    wrap.innerHTML = svg;
    document.body.insertBefore(wrap, document.body.firstChild);
    _spriteLoaded = true;
  } catch { /* icons gracefully absent */ }
}

const ICON_OVERRIDES = {
  'Cows':'Cow','Chickens':'Chicken','Iron':'IronBar','Copper':'CopperBar',
  'Rations':'BasicRations','Fine Rations':'FineRations','Exosuit':'BasicExosuit',
  'Tools':'BasicTools','Advanced Tools':'AdvancedTools','Adv. Tools':'AdvancedTools',
  'Construction Kit':'BasicConstructionKit','Prefab Kit':'BasicPrefabKit',
  'Modern Prefab Kit':'ModernPrefabKit','Advanced Prefab Kit':'AdvancedPrefabKit',
  'Amenities':'BasicAmenities','Advanced Amenities':'AdvancedAmenities',
  'Hull Plate':'BasicHullPlate','Pump':'BasicPump','Assembly Plant':'BasicAssemblyPlant',
  'Truss':'ReinforcedTruss','Linear FTL Emitter':'BasicFTLEmitter',
  'Copper Wire':'CopperWiring','Consumer Electronics':'Electronics',
  'Electric Motor':'Motor','Artificial Intelligence':'AI','AI':'AI',
  'Advanced Processing Unit':'APU','APU':'APU','Nanites':'Nanobots',
  'Bio-Nutrient Blend':'NutrientBlend','Nutrient Blend':'NutrientBlend',
  'Hydrogen Fuel':'HydrogenFuelCell','Superconducting Coil':'HyperCoil',
  'SuperCoil':'HyperCoil','Field Cooling System':'FieldCooling',
  'Field Cooling':'FieldCooling','Titanium Carbide Drill':'AdvancedDrill',
  'TiC Drill':'AdvancedDrill','Molecular Fusion Kit':'WeldingKit2',
  'Ethanol':'Gasoline','Graphenium Wire':'Superconductors',
  'Starglass Hull Plate':'QuadraniumHullPlate','Ship Repair Kit':'ShipRepairKit',
  'Lab Suit':'LaboratorySuit','Laboratory Suit':'LaboratorySuit',
  'Lab. Suit':'LaboratorySuit','Chemical Plant':'ChemistryPlant',
  'Micronics Factory':'MicroelectronicsFactory','Quantum Nexus':'QuantumComputingCenter',
  'Research':'ResearchData','Research Data':'ResearchData',
  'Advanced Research':'AdvancedResearchData','Advanced Research Data':'AdvancedResearchData',
  'Adv. Research Data':'AdvancedResearchData','Apex Research':'ApexResearchData',
  'Apex Research Data':'ApexResearchData','Quantum Research':'QuantumResearchData',
  'Quantum Research Data':'QuantumResearchData',
  'Quantum FTL Emitter':'AdvancedFTLEmitter',
  'Extra-dimensional FTL Emitter':'SuperiorFTLEmitter',
  'Shuttle Bridge':'BasicShipBridge','Hauler Bridge':'AdvancedShipBridge',
  'Freighter Bridge':'T4ShipBridge','Starlifter Structural Elements':'T4ShipElements',
  'Medicine Shipment':'Pack_Medicine','Food Shipment':'Pack_Food',
  'Ship Parts Shipment':'Pack_ShipParts','Defense systems pack':'Pack_Defense',
  'Habitats Shipment':'Pack_Habitats',
  'Scientific Instruments Shipment':'Pack_Scientific','Gifts':'Pack_Gifts',
};

function toIconId(name) {
  if (!name) return '';
  if (ICON_OVERRIDES[name]) return ICON_OVERRIDES[name];
  return name.replace(/[^a-zA-Z0-9 ]/g, '').split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function makeIcon(matName, size = 14) {
  if (!_spriteLoaded) return null;
  const id = toIconId(matName);
  if (!id) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `width:${size}px;height:${size}px;vertical-align:middle;flex-shrink:0;display:inline-block;`;
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

const HEADER_H = 38; // px

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

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  targetDays:         1,
  critHours:          6,   // below this → red
  lowHours:           18,  // below this → amber; above → green
  includeStock:       true,
  includeInputs:      true,
  includeConsumables: true,
  hiddenBases:        [],
  // Feature visibility
  showGTE:          true,
  showSummary:      true,
  showAssets:       true,
  showWishlist:     true,
  showGuildPrices:  true,
  showCosts:        false,
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
async function fetchBases(apiKey) {
  if (_basesCache.data && Date.now() - _basesCache.ts < BASES_CACHE_TTL) {
    return _basesCache.data;
  }
  // Try Local API first
  const company = await requestGTLocalAPI('getMyCompany');
  if (company) {
    const bases = company.bases ?? company.buildingBases ?? (Array.isArray(company) ? company : null);
    if (Array.isArray(bases) && bases.length) {
      _basesCache = { data: bases, ts: Date.now() };
      return bases;
    }
  }
  // Fall back to direct API
  if (!apiKey) throw new Error('No API key and local API unavailable');
  const resp = await fetch(`${GT_API}/public/company/bases?apikey=${encodeURIComponent(apiKey)}`);
  if (!resp.ok) throw new Error(`bases fetch failed: ${resp.status}`);
  const data = await resp.json();
  _basesCache = { data, ts: Date.now() };
  return data;
}

// ── Company data cache ────────────────────────────────────────────────────────

let _companyData   = null;
let _companyDataTs = 0;
const COMPANY_TTL  = 5 * 60 * 1000;

async function fetchCompanyData() {
  if (_companyData && Date.now() - _companyDataTs < COMPANY_TTL) return _companyData;
  const local = await requestGTLocalAPI('getMyCompany');
  if (local?.id) { _companyData = local; _companyDataTs = Date.now(); return local; }
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

  // Try Local API first
  const localPrices = await requestGTLocalAPI('getPrices');
  if (localPrices) {
    const map = extractPriceMap(localPrices);
    if (map.size > 0) {
      _priceMap = map; _priceMapTs = Date.now();
      return map;
    }
  }

  // Fall back to direct API
  const apiKey = await getExtApiKey();
  if (!apiKey) return null;
  try {
    const resp = await fetch(`${GT_API}/public/exchange/mat-prices?apikey=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) return null;
    const map = extractPriceMap(await resp.json());
    _priceMap   = map;
    _priceMapTs = Date.now();
    return map;
  } catch { return null; }
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
    const task   = slot.building.task;
    const recipe = recipeMap.get(task.rId);
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

  // Worker consumables — rate is pre-calculated daily consumption
  const consumables = (base.workforce?.consumptionMaterials ?? []).map(c => {
    const inStock = warehouseAmts.get(c.matId) ?? 0;
    const days    = c.rate > 0 ? inStock / c.rate : Infinity;
    return {
      matId: c.matId,
      name:  matMap.get(c.matId)?.sName ?? `mat${c.matId}`,
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
      name:  matMap.get(out.id)?.sName ?? `mat${out.id}`,
      dailyOutput,
    });
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
  document.getElementById(GT_HEADER_ID)?.remove();
  document.getElementById(GT_DETAIL_ID)?.remove();
  document.getElementById(GT_SPACER_ID)?.remove();
  document.getElementById(GT_TAB_ID)?.remove();
  document.getElementById(GT_CASH_ID)?.remove();
  document.getElementById(GT_SUMMARY_ID)?.remove();
  _detailBaseId = null;
  _headerCollapsed = false;
  _cashOpen = false;
  _summaryOpen = false;
}

// ── Detail panel (drops below header when a chip is clicked) ──────────────────

function buildDetailPanel(base, gamedata) {
  const { inputs, consumables, outputs } = calcBaseNeeds(base, gamedata);

  const panel = document.createElement('div');
  panel.id = GT_DETAIL_ID;
  Object.assign(panel.style, {
    position: 'fixed', top: `${HEADER_H}px`, left: '0',
    minWidth: '300px', maxWidth: '420px',
    maxHeight: 'calc(65vh - 38px)', overflowY: 'auto',
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

  // Content area — rebuilt when cost toggle changes
  const contentArea = document.createElement('div');
  panel.appendChild(contentArea);

  const td = _settings.targetDays;

  function rebuildContent() {
    contentArea.innerHTML = '';
    const prices = _priceMap;
    const showCosts = _settings.showCosts; // column always visible when toggle is on; shows — if prices missing
    let totalDailyInputCost = 0;
    let totalDailyOutputValue = 0;

    const renderSection = (items, heading, cartLabel) => {
      if (!items.length) return;

      const hRow = document.createElement('div');
      hRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:6px 0 3px;';
      const h = document.createElement('span');
      h.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
      h.textContent = heading;
      const sectionCart = document.createElement('button');
      sectionCart.innerHTML = '&#128722;';
      sectionCart.title = `Wishlist: ${heading}`;
      sectionCart.style.cssText = 'background:none;border:none;cursor:pointer;font-size:11px;padding:0;line-height:1;color:#6b6b8a;flex-shrink:0;';
      sectionCart.addEventListener('mouseenter', () => { sectionCart.style.color = COL_OK; });
      sectionCart.addEventListener('mouseleave', () => { if (!sectionCart.disabled) sectionCart.style.color = '#6b6b8a'; });
      sectionCart.addEventListener('click', () => handleSectionWishlist(base, items, cartLabel, sectionCart));
      hRow.appendChild(h);
      hRow.appendChild(sectionCart);
      contentArea.appendChild(hRow);

      let sectionRestockCost = 0;
      let sectionDailyCost   = 0;
      for (const r of items) {
        const col     = daysColour(r.days);
        const daysStr = fmtDays(r.days);
        const deficit = Math.max(0, Math.ceil(r.dailyNeed * td - r.inStock));
        const needStr  = Math.round(r.dailyNeed).toLocaleString() + '/d';
        const unitPrice = prices?.get(Number(r.matId)) ?? 0;
        const lineCost  = unitPrice * deficit;
        const lineDailyCost = unitPrice * r.dailyNeed;
        sectionRestockCost += lineCost;
        sectionDailyCost   += lineDailyCost;
        totalDailyInputCost += lineDailyCost;

        // cols: name | need/d | deficit | [cost] | days
        const cols = showCosts ? '1fr auto auto auto auto' : '1fr auto auto auto';
        const row = document.createElement('div');
        row.style.cssText = `display:grid;grid-template-columns:${cols};gap:5px;align-items:center;padding:3px 0;border-bottom:1px solid #12122a;`;

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color:#c0c0da;display:flex;align-items:center;gap:4px;min-width:0;';
        const icon0 = makeIcon(r.name);
        if (icon0) nameSpan.appendChild(icon0);
        const nameText0 = document.createElement('span');
        nameText0.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameText0.textContent = r.name;
        nameSpan.appendChild(nameText0);

        const needSpan = document.createElement('span');
        needSpan.style.cssText = 'color:#6b6b8a;font-size:10px;white-space:nowrap;';
        needSpan.textContent = needStr;

        const deficitSpan = document.createElement('span');
        deficitSpan.style.cssText = `color:${col};font-size:10px;white-space:nowrap;`;
        deficitSpan.textContent = `(${deficit > 0 ? deficit.toLocaleString() : '0'})`;

        const daysSpan = document.createElement('span');
        daysSpan.style.cssText = `color:${col};font-size:11px;font-weight:600;min-width:28px;text-align:right;`;
        daysSpan.textContent = daysStr;

        row.appendChild(nameSpan);
        row.appendChild(needSpan);
        row.appendChild(deficitSpan);
        if (showCosts) {
          const costSpan = document.createElement('span');
          costSpan.style.cssText = 'color:#9090b0;font-size:10px;white-space:nowrap;text-align:right;';
          costSpan.textContent = lineCost > 0 ? lineCost.toLocaleString(undefined, {maximumFractionDigits:0}) : '\u2014';
          row.appendChild(costSpan);
        }
        row.appendChild(daysSpan);
        contentArea.appendChild(row);
      }

      if (showCosts && (sectionRestockCost > 0 || sectionDailyCost > 0)) {
        const totRow = document.createElement('div');
        totRow.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;padding:3px 0 1px;border-top:1px solid #1a1a2e;margin-top:2px;';
        const totLabel = document.createElement('span');
        totLabel.style.cssText = 'color:#6b6b8a;font-size:10px;';
        totLabel.textContent = 'Section total';
        const restockVal = document.createElement('span');
        restockVal.style.cssText = 'color:#9090b0;font-size:10px;text-align:right;white-space:nowrap;';
        restockVal.title = 'Restock cost';
        restockVal.textContent = sectionRestockCost > 0 ? `$${Math.round(sectionRestockCost).toLocaleString()}` : '\u2014';
        const dailyVal = document.createElement('span');
        dailyVal.style.cssText = 'color:#6b6b8a;font-size:10px;text-align:right;white-space:nowrap;';
        dailyVal.title = 'Daily cost';
        dailyVal.textContent = sectionDailyCost > 0 ? `$${Math.round(sectionDailyCost).toLocaleString()}/d` : '\u2014';
        totRow.append(totLabel, restockVal, dailyVal);
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
    if (outputs.length) {
      const oh = document.createElement('div');
      oh.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:6px 0 3px;';
      const ohLabel = document.createElement('span');
      ohLabel.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
      ohLabel.textContent = 'Outputs / day';
      oh.appendChild(ohLabel);
      contentArea.appendChild(oh);

      for (const r of outputs) {
        const unitPrice   = prices?.get(Number(r.matId)) ?? 0;
        const dailyValue  = unitPrice * r.dailyOutput;
        totalDailyOutputValue += dailyValue;

        const cols = showCosts ? '1fr auto auto' : '1fr auto';
        const row = document.createElement('div');
        row.style.cssText = `display:grid;grid-template-columns:${cols};gap:5px;align-items:center;padding:3px 0;border-bottom:1px solid #12122a;`;

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
        qtySpan.textContent = Math.round(r.dailyOutput).toLocaleString() + '/d';

        row.appendChild(nameSpan);
        row.appendChild(qtySpan);

        if (showCosts) {
          const valSpan = document.createElement('span');
          valSpan.style.cssText = `color:${COL_OK};font-size:10px;white-space:nowrap;text-align:right;`;
          valSpan.textContent = dailyValue > 0 ? fmtCr(dailyValue) + '/d' : '\u2014';
          row.appendChild(valSpan);
        }
        contentArea.appendChild(row);
      }

      if (showCosts && totalDailyOutputValue > 0) {
        const totRow = document.createElement('div');
        totRow.style.cssText = 'display:flex;justify-content:flex-end;padding:3px 0 1px;color:#22c55e;font-size:10px;';
        totRow.textContent = 'Income: ' + fmtCr(totalDailyOutputValue) + '/d';
        contentArea.appendChild(totRow);
      }
    }

    // Net profit row (only when showCosts is on and we have some data)
    if (showCosts && (totalDailyOutputValue > 0 || totalDailyInputCost > 0)) {
      const netProfit = totalDailyOutputValue - totalDailyInputCost;
      const netRow = document.createElement('div');
      netRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0 2px;border-top:2px solid #1e1e3a;margin-top:4px;';
      const netLabel = document.createElement('span');
      netLabel.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
      netLabel.textContent = 'Net profit';
      const netVal = document.createElement('span');
      const netCol = netProfit >= 0 ? COL_OK : COL_CRIT;
      netVal.style.cssText = `color:${netCol};font-size:12px;font-weight:700;`;
      netVal.textContent = (netProfit >= 0 ? '+' : '\u2212') + fmtCr(Math.abs(netProfit)) + '/d';
      netRow.appendChild(netLabel);
      netRow.appendChild(netVal);
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
    .map(r => ({
      id: r.matId,
      am: _settings.includeStock
        ? Math.max(0, Math.ceil(r.dailyNeed * td - r.inStock))
        : Math.ceil(r.dailyNeed * td),
    }))
    .filter(m => m.am > 0);
}

// Core wishlist API call — animates btn, shows toast, returns true on success
async function submitWishlist(title, mats, btn) {
  const apiKey = await getExtApiKey();
  if (!apiKey) {
    showToast('Extended API key needed \u2014 set in popup', false);
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
async function handleWishlistAll(btn) {
  const apiKey = await getExtApiKey();
  if (!apiKey) { showToast('Extended API key needed \u2014 set in popup', false); return; }
  if (!_loadedHeaderBases || !_loadedHeaderGamedata) return;

  const bases = sortBases(_loadedHeaderBases).filter(b => !_settings.hiddenBases.includes(String(b.id)));
  if (!bases.length) return;

  btn.disabled = true;
  const origText = btn.textContent;
  btn.style.color = COL_LOW;

  let ok = 0, fail = 0, skip = 0;
  for (const base of bases) {
    const { inputs, consumables } = calcBaseNeeds(base, _loadedHeaderGamedata);
    const eligible = [
      ...(_settings.includeInputs      ? inputs      : []),
      ...(_settings.includeConsumables ? consumables : []),
    ];
    const mats = buildMatList(eligible);
    if (!mats.length) { skip++; continue; }
    try {
      const resp = await fetch(
        `${GT_API}/public/wishlist/create?apikey=${encodeURIComponent(apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `${base.name} \u2014 ${_settings.targetDays}d restock`, mats }) }
      );
      if (!resp.ok) throw new Error();
      ok++;
    } catch { fail++; }
  }

  btn.disabled = false;
  btn.style.color = fail ? COL_CRIT : COL_OK;
  btn.textContent = origText;
  setTimeout(() => { btn.style.color = ''; }, 3000);

  if (fail)      showToast(`${ok} wishlists created, ${fail} failed`, false);
  else if (skip) showToast(`\u2713 ${ok} wishlists created (${skip} bases already stocked)`);
  else           showToast(`\u2713 ${ok} wishlists created`);
}

// Delete All Wishlists — fetches then deletes each one
async function handleDeleteAllWishlists(btn, resetFn) {
  const apiKey = await getExtApiKey();
  if (!apiKey) { showToast('Extended API key needed \u2014 set in popup', false); resetFn(); return; }

  btn.disabled = true;
  btn.textContent = 'Fetching\u2026';

  try {
    let lists = null;
    const localLists = await requestGTLocalAPI('getWishlists');
    if (localLists) {
      lists = localLists.wishlists ?? (Array.isArray(localLists) ? localLists : null);
    }
    if (!lists) {
      const resp = await fetch(`${GT_API}/public/wishlists?apikey=${encodeURIComponent(apiKey)}`);
      if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
      lists = await resp.json();
    }
    if (!lists.length) { showToast('No wishlists found'); resetFn(); return; }

    let deleted = 0, failed = 0;
    for (const wl of lists) {
      try {
        const r = await fetch(
          `${GT_API}/public/wishlist/${wl.id}?apikey=${encodeURIComponent(apiKey)}`,
          { method: 'DELETE' }
        );
        if (!r.ok) throw new Error();
        deleted++;
      } catch { failed++; }
    }

    if (failed) showToast(`${deleted} deleted, ${failed} failed`, false);
    else        showToast(`\u2713 ${deleted} wishlists deleted`);
  } catch (err) {
    showToast(`Error: ${err.message}`, false);
  } finally {
    resetFn();
  }
}

// ── Header chip ───────────────────────────────────────────────────────────────

function buildHeaderChip(base, gamedata) {
  const { inputs, consumables } = calcBaseNeeds(base, gamedata);
  const relevant = [
    ...(_settings.includeInputs      ? inputs      : []),
    ...(_settings.includeConsumables ? consumables : []),
  ];
  const allDays  = relevant.map(r => r.days).filter(d => isFinite(d));
  const worstDay = allDays.length ? Math.min(...allDays) : Infinity;
  const col      = daysColour(worstDay);
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
  cartBtn.style.cssText = `background:none;border:none;cursor:pointer;font-size:11px;padding:0;margin-left:1px;line-height:1;color:inherit;flex-shrink:0;display:${_settings.showWishlist ? '' : 'none'};`;
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
  return label;
}

function buildSettingsPanel() {
  const panel = document.createElement('div');
  panel.id = GT_SETTINGS_ID;
  Object.assign(panel.style, {
    position: 'fixed', top: `${HEADER_H}px`, right: '0',
    width: '220px',
    background: '#0a0a18', border: '1px solid #2a2a4a',
    borderTop: 'none', borderRadius: '0 0 0 8px',
    padding: '10px 12px 12px',
    fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#b0b0cc',
    zIndex: '2147483645', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
  });

  // Title
  const title = document.createElement('div');
  title.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;';
  title.textContent = 'Settings';
  panel.appendChild(title);

  // ── Helper: collapsible section ───────────────────────────────────────────
  function mkCollapsible(labelText, startOpen = false) {
    const wrap = document.createElement('div');
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid #1a1a30;margin:6px 0 0;';
    wrap.appendChild(sep);

    let open = startOpen;
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0 4px;cursor:pointer;';

    const lbl = document.createElement('span');
    lbl.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
    lbl.textContent = labelText;

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
      const header = document.getElementById(GT_HEADER_ID);
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
  const wishBody = mkCollapsible('Wishlisting');

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

    const expLabel = document.createElement('span');
    expLabel.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
    expLabel.textContent = `Bases (${_loadedHeaderBases.length})`;

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
    basesNote.textContent = 'Hidden bases are excluded from the summary panel and wishlist all.';
    basesList.appendChild(basesNote);

    expRow.addEventListener('click', () => {
      basesExpanded = !basesExpanded;
      basesList.style.display = basesExpanded ? 'block' : 'none';
      basesNote.style.display = basesExpanded ? 'block' : 'none';
      expArrow.textContent = basesExpanded ? '\u25b4' : '\u25be';
    });

    for (const base of sortBases(_loadedHeaderBases)) {
      const bid = String(base.id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:2px 0;';

      const lbl = document.createElement('span');
      lbl.style.color = '#c0c0da';
      lbl.textContent = base.name;

      const tog = buildMiniToggle(!_settings.hiddenBases.includes(bid), (visible) => {
        if (visible) {
          _settings.hiddenBases = _settings.hiddenBases.filter(id => id !== bid);
        } else {
          if (!_settings.hiddenBases.includes(bid)) _settings.hiddenBases.push(bid);
        }
        saveSettings();
        // Update header chips immediately
        const header = document.getElementById(GT_HEADER_ID);
        const chipArea = header?.querySelector('[data-chip-area]');
        if (chipArea && _loadedHeaderGamedata) {
          const existing = chipArea.querySelector(`[data-base-id="${bid}"]`);
          if (visible && !existing) {
            chipArea.querySelectorAll('[data-base-id]').forEach(c => c.remove());
            const sorted = sortBases(_loadedHeaderBases).filter(b => !_settings.hiddenBases.includes(String(b.id)));
            for (const b of sorted) chipArea.appendChild(buildHeaderChip(b, _loadedHeaderGamedata));
          } else if (!visible && existing) {
            existing.remove();
            if (_detailBaseId === bid) {
              document.getElementById(GT_DETAIL_ID)?.remove();
              _detailBaseId = null;
            }
          }
        }
      });

      row.appendChild(lbl);
      row.appendChild(tog);
      basesList.appendChild(row);
    }
  }

  // Feature visibility section
  const sepFeat = document.createElement('div');
  sepFeat.style.cssText = 'border-top:1px solid #1a1a30;margin:8px 0 0;';
  panel.appendChild(sepFeat);

  const featTitle = document.createElement('div');
  featTitle.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:7px 0 5px;';
  featTitle.textContent = 'Feature Visibility';
  panel.appendChild(featTitle);

  const featToggles = [
    { key: 'showCosts',       label: 'Show costs / values' },
    { key: 'showGuildPrices', label: 'Guild prices in-game' },
    { key: 'showGTE',         label: 'Guild Trade (GTE)' },
    { key: 'showSummary',     label: 'Summary panel' },
    { key: 'showAssets',      label: 'Cash & assets panel' },
    { key: 'showWishlist',    label: 'Wishlist buttons' },
  ];

  for (const { key, label } of featToggles) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 0;';

    const lbl = document.createElement('span');
    lbl.style.color = '#c0c0da';
    lbl.textContent = label;

    const tog = buildMiniToggle(_settings[key], (val) => {
      _settings[key] = val;
      saveSettings();
      if (key === 'showCosts') {
        // Rebuild chips + detail live without full reload
        const header = document.getElementById(GT_HEADER_ID);
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
      } else if (key === 'showGuildPrices') {
        if (val) run(); else removeInjection();
      } else {
        _basesCache = { data: null, ts: 0 };
        document.getElementById(GT_SETTINGS_ID)?.remove();
        _settingsOpen = false;
        loadAndInjectHeader();
      }
    });

    row.appendChild(lbl);
    row.appendChild(tog);
    panel.appendChild(row);
  }

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

// Cached references for live chip updates
let _loadedHeaderBases    = null;
let _loadedHeaderGamedata = null;

// Sort: numeric prefix first, then alphabetical
function sortBases(bases) {
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
    width: '260px', maxHeight: 'calc(75vh - 38px)', overflowY: 'auto',
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

let _cashOpen = false;

function closeAllPanels() {
  document.getElementById(GT_DETAIL_ID)?.remove();   _detailBaseId = null;
  document.getElementById(GT_SETTINGS_ID)?.remove(); _settingsOpen = false;
  document.getElementById(GT_CASH_ID)?.remove();     _cashOpen     = false;
  document.getElementById(GT_SUMMARY_ID)?.remove();  _summaryOpen  = false;
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

  const [company, prices] = await Promise.all([fetchCompanyData(), fetchMatPrices()]);
  loading.remove();

  // Cash balance — game API returns cents, divide by 100
  const cashRaw = company?.cash ?? company?.credits ?? company?.balance ?? company?.money ?? null;
  const cashNum = cashRaw !== null ? cashRaw / 100 : null;
  if (cashNum !== null) {
    panel.appendChild(mkRow('Cash', fmtCr(cashNum), COL_OK));
    panel.appendChild(mkSep());
  }

  // Base inventory value
  const bases = sortBases(_loadedHeaderBases ?? []);
  let totalInv = 0;
  if (bases.length && prices) {
    const subTitle = document.createElement('div');
    subTitle.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin:4px 0 4px;';
    subTitle.textContent = 'Base Inventory';
    panel.appendChild(subTitle);

    for (const base of bases) {
      let val = 0;
      if (_loadedHeaderGamedata) {
        const { outputs } = calcBaseNeeds(base, _loadedHeaderGamedata);
        const warehouseAmts = new Map((base.warehouse?.mats ?? []).map(m => [Number(m.id), m.am ?? 0]));
        for (const out of outputs) {
          val += (warehouseAmts.get(Number(out.matId)) ?? 0) * (prices.get(Number(out.matId)) ?? 0);
        }
      }
      totalInv += val;
      panel.appendChild(mkRow(base.name, fmtCr(val)));
    }
    panel.appendChild(mkSep());
  }

  // Exchange listings (active sell orders)
  let exchangeListingsVal = 0;
  const listings = company?.exchangeListings ?? company?.listings ?? company?.exchange?.listings ?? [];
  if (listings.length && prices) {
    const exTitle = document.createElement('div');
    exTitle.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin:4px 0 4px;';
    exTitle.textContent = 'Exchange Listings';
    panel.appendChild(exTitle);
    for (const l of listings) {
      const matId = Number(l.matId ?? l.id);
      const qty   = l.qty ?? l.amount ?? l.am ?? 0;
      const val   = qty * (prices.get(matId) ?? 0);
      exchangeListingsVal += val;
      const name  = l.matName ?? l.name ?? `mat${matId}`;
      panel.appendChild(mkRow(name, qty.toLocaleString() + ' × ' + fmtCr(prices.get(matId) ?? 0)));
    }
    panel.appendChild(mkRow('Listings total', fmtCr(exchangeListingsVal), COL_OK));
    panel.appendChild(mkSep());
  }

  // Exchange warehouse — output items only
  let exchangeWarehouseVal = 0;
  const exchWarehouseMats = company?.exchangeWarehouse?.mats
    ?? company?.exchange?.warehouse?.mats
    ?? company?.exchangeWarehouses?.[0]?.mats
    ?? [];
  if (exchWarehouseMats.length && prices && _loadedHeaderGamedata) {
    // Collect all output matIds across all bases
    const outputMatIds = new Set();
    for (const base of (_loadedHeaderBases ?? [])) {
      const { outputs } = calcBaseNeeds(base, _loadedHeaderGamedata);
      outputs.forEach(o => outputMatIds.add(Number(o.matId)));
    }
    const exchOutputMats = exchWarehouseMats.filter(m => outputMatIds.has(Number(m.id)));
    if (exchOutputMats.length) {
      const exwTitle = document.createElement('div');
      exwTitle.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin:4px 0 4px;';
      exwTitle.textContent = 'Exchange Warehouse';
      panel.appendChild(exwTitle);
      for (const m of exchOutputMats) {
        const matId = Number(m.id);
        const val   = (m.am ?? 0) * (prices.get(matId) ?? 0);
        exchangeWarehouseVal += val;
        const matInfo = _loadedHeaderGamedata.materials?.find(mat => mat.id === matId);
        panel.appendChild(mkRow(matInfo?.sName ?? `mat${matId}`, fmtCr(val)));
      }
      panel.appendChild(mkRow('Exchange warehouse total', fmtCr(exchangeWarehouseVal), COL_OK));
      panel.appendChild(mkSep());
    }
  }

  const cashVal = typeof cashNum === 'number' ? cashNum : 0;
  const total   = cashVal + totalInv + exchangeListingsVal + exchangeWarehouseVal;
  if (total > 0) {
    panel.appendChild(mkRow('Total', fmtCr(total), '#d8d8f0'));
  }
  if (!prices) {
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

let _summaryOpen     = false;
let _summaryPerBase  = false;

function buildSummaryContent(container, perBase) {
  container.innerHTML = '';
  if (!_loadedHeaderBases || !_loadedHeaderGamedata) return;

  const bases = sortBases(_loadedHeaderBases).filter(b => !_settings.hiddenBases.includes(String(b.id)));
  const prices = _priceMap;

  const renderInputRows = (items, parent) => {
    items.forEach(r => {
      const col = daysColour(r.days);
      const deficit = Math.max(0, Math.ceil(r.dailyNeed * _settings.targetDays - r.inStock));

      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto auto;gap:5px;align-items:center;padding:2px 0;border-bottom:1px solid #12122a;';

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'color:#c0c0da;display:flex;align-items:center;gap:4px;min-width:0;';
      const ic = makeIcon(r.name, 12);
      if (ic) nameSpan.appendChild(ic);
      const nt = document.createElement('span');
      nt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;';
      nt.textContent = r.name;
      nameSpan.appendChild(nt);

      const needSpan = document.createElement('span');
      needSpan.style.cssText = 'color:#6b6b8a;font-size:10px;white-space:nowrap;';
      needSpan.textContent = Math.round(r.dailyNeed).toLocaleString() + '/d';

      const defSpan = document.createElement('span');
      defSpan.style.cssText = `color:${col};font-size:10px;white-space:nowrap;`;
      defSpan.textContent = `(${deficit > 0 ? deficit.toLocaleString() : '0'})`;

      const daysSpan = document.createElement('span');
      daysSpan.style.cssText = `color:${col};font-size:11px;font-weight:600;text-align:right;`;
      daysSpan.textContent = fmtDays(r.days);

      row.appendChild(nameSpan); row.appendChild(needSpan);
      row.appendChild(defSpan);  row.appendChild(daysSpan);
      parent.appendChild(row);
    });
  };

  const renderOutputRows = (items, parent) => {
    items.forEach(r => {
      const dailyVal = prices ? (prices.get(Number(r.matId)) ?? 0) * r.dailyOutput : 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:5px;align-items:center;padding:2px 0;border-bottom:1px solid #12122a;';

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'color:#c0c0da;display:flex;align-items:center;gap:4px;min-width:0;';
      const ic = makeIcon(r.name, 12);
      if (ic) nameSpan.appendChild(ic);
      const nt = document.createElement('span');
      nt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;';
      nt.textContent = r.name;
      nameSpan.appendChild(nt);

      const qtySpan = document.createElement('span');
      qtySpan.style.cssText = 'color:#9090b0;font-size:10px;white-space:nowrap;';
      qtySpan.textContent = Math.round(r.dailyOutput).toLocaleString() + '/d';

      const valSpan = document.createElement('span');
      valSpan.style.cssText = `color:${COL_OK};font-size:10px;white-space:nowrap;text-align:right;`;
      valSpan.textContent = dailyVal > 0 ? fmtCr(dailyVal) + '/d' : '\u2014';

      row.appendChild(nameSpan); row.appendChild(qtySpan); row.appendChild(valSpan);
      parent.appendChild(row);
    });
  };

  const mkSection = (label, parent) => {
    const h = document.createElement('div');
    h.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin:8px 0 3px;';
    h.textContent = label;
    parent.appendChild(h);
  };

  const renderInputTotals = (items, parent) => {
    if (!prices || !items.length) return;
    const td = _settings.targetDays;
    let restockCost = 0, dailyCost = 0;
    items.forEach(r => {
      const p = prices.get(Number(r.matId)) ?? 0;
      restockCost += p * Math.max(0, Math.ceil(r.dailyNeed * td - r.inStock));
      dailyCost   += p * r.dailyNeed;
    });
    if (!restockCost && !dailyCost) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;padding:3px 0 1px;border-top:1px solid #1e1e3a;margin-top:2px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'color:#6b6b8a;font-size:10px;';
    lbl.textContent = 'Total';
    const rv = document.createElement('span');
    rv.style.cssText = 'color:#9090b0;font-size:10px;text-align:right;white-space:nowrap;';
    rv.title = 'Restock cost';
    rv.textContent = restockCost > 0 ? `$${Math.round(restockCost).toLocaleString()}` : '\u2014';
    const dv = document.createElement('span');
    dv.style.cssText = 'color:#6b6b8a;font-size:10px;text-align:right;white-space:nowrap;';
    dv.title = 'Daily cost';
    dv.textContent = dailyCost > 0 ? `$${Math.round(dailyCost).toLocaleString()}/d` : '\u2014';
    row.append(lbl, rv, dv);
    parent.appendChild(row);
  };

  if (perBase) {
    // ── Per-base view ──
    for (const base of bases) {
      const { inputs, consumables, outputs } = calcBaseNeeds(base, _loadedHeaderGamedata);
      const eligible = [...inputs, ...consumables]
        .map(r => ({ ...r, days: r.dailyNeed > 0 ? r.inStock / r.dailyNeed : Infinity }));

      const hdr = document.createElement('div');
      hdr.style.cssText = 'color:#d1d5db;font-size:12px;font-weight:600;margin:10px 0 3px;padding-top:6px;border-top:1px solid #1e1e3a;';
      hdr.textContent = base.name;
      container.appendChild(hdr);

      if (eligible.length) { renderInputRows(eligible, container); renderInputTotals(eligible, container); }
      if (outputs.length)  { mkSection('Outputs', container); renderOutputRows(outputs, container); }
      if (!eligible.length && !outputs.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#6b6b8a;font-size:11px;font-style:italic;padding:2px 0;';
        empty.textContent = 'No active production';
        container.appendChild(empty);
      }
      // Per-base net profit
      if (prices && (eligible.length || outputs.length)) {
        const dailyIncome = outputs.reduce((s, r) => s + (prices.get(Number(r.matId)) ?? 0) * r.dailyOutput, 0);
        const dailyCost   = eligible.reduce((s, r) => s + (prices.get(Number(r.matId)) ?? 0) * r.dailyNeed, 0);
        const net = dailyIncome - dailyCost;
        const netCol = net >= 0 ? COL_OK : COL_CRIT;
        const nr = document.createElement('div');
        nr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0 2px;border-top:1px solid #1e1e3a;margin-top:3px;';
        const nl = document.createElement('span');
        nl.style.cssText = 'color:#6b6b8a;font-size:10px;';
        nl.textContent = 'Net profit';
        const nv = document.createElement('span');
        nv.style.cssText = `color:${netCol};font-size:11px;font-weight:700;`;
        nv.textContent = (net >= 0 ? '+' : '\u2212') + fmtCr(Math.abs(net)) + '/d';
        nr.appendChild(nl); nr.appendChild(nv);
        container.appendChild(nr);
      }
    }
  } else {
    // ── Aggregate view ──
    const inputsMap  = new Map(); // matId → {name, dailyNeed, inStock}
    const outputsMap = new Map(); // matId → {name, dailyOutput}

    for (const base of bases) {
      const { inputs, consumables, outputs } = calcBaseNeeds(base, _loadedHeaderGamedata);
      const eligible = [...inputs, ...consumables];
      for (const r of eligible) {
        const ex = inputsMap.get(r.matId);
        if (ex) { ex.dailyNeed += r.dailyNeed; ex.inStock += r.inStock; }
        else inputsMap.set(r.matId, { name: r.name, matId: r.matId, dailyNeed: r.dailyNeed, inStock: r.inStock });
      }
      for (const r of outputs) {
        const ex = outputsMap.get(r.matId);
        if (ex) { ex.dailyOutput += r.dailyOutput; }
        else outputsMap.set(r.matId, { name: r.name, matId: r.matId, dailyOutput: r.dailyOutput });
      }
    }

    const aggInputs = [...inputsMap.values()].map(r => ({
      ...r, days: r.dailyNeed > 0 ? r.inStock / r.dailyNeed : Infinity,
    })).sort((a, b) => (isFinite(a.days) ? a.days : 1e9) - (isFinite(b.days) ? b.days : 1e9));

    const aggOutputs = [...outputsMap.values()];
    let totalDailyValue = 0;
    let totalDailyInputCost = 0;
    if (prices) {
      aggOutputs.forEach(r => { totalDailyValue += (prices.get(Number(r.matId)) ?? 0) * r.dailyOutput; });
      aggInputs.forEach(r => { totalDailyInputCost += (prices.get(Number(r.matId)) ?? 0) * r.dailyNeed; });
    }

    if (aggInputs.length)  { mkSection('All Inputs', container);  renderInputRows(aggInputs, container); renderInputTotals(aggInputs, container); }
    if (aggOutputs.length) { mkSection('All Outputs', container); renderOutputRows(aggOutputs, container); }

    if (totalDailyValue > 0 || totalDailyInputCost > 0) {
      const netProfit = totalDailyValue - totalDailyInputCost;
      const netCol = netProfit >= 0 ? COL_OK : COL_CRIT;
      const tot = document.createElement('div');
      tot.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:5px 0 2px;border-top:2px solid #1e1e3a;margin-top:4px;`;
      const totLabel = document.createElement('span');
      totLabel.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
      totLabel.textContent = 'Net profit';
      const totVal = document.createElement('span');
      totVal.style.cssText = `color:${netCol};font-size:12px;font-weight:700;`;
      totVal.textContent = (netProfit >= 0 ? '+' : '\u2212') + fmtCr(Math.abs(netProfit)) + '/d';
      tot.appendChild(totLabel); tot.appendChild(totVal);
      container.appendChild(tot);
    }
    if (!aggInputs.length && !aggOutputs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#6b6b8a;font-style:italic;padding:4px 0;';
      empty.textContent = 'No active production detected.';
      container.appendChild(empty);
    }
  }
}

function toggleSummaryPanel() {
  const existing = document.getElementById(GT_SUMMARY_ID);
  if (existing) { existing.remove(); _summaryOpen = false; return; }

  closeAllPanels();
  const panel = mkPanelBase(GT_SUMMARY_ID, false); // left-aligned
  panel.style.width = '340px';

  // Header row with title + per-base toggle
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
  titleEl.textContent = 'Summary';
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
  hdr.appendChild(titleEl); hdr.appendChild(viewToggle);
  panel.appendChild(hdr);

  const content = document.createElement('div');
  panel.appendChild(content);
  buildSummaryContent(content, _summaryPerBase);

  document.body.appendChild(panel);
  _summaryOpen = true;
}

// ── Header injection ──────────────────────────────────────────────────────────

async function loadAndInjectHeader() {
  const apiKey = await getExtApiKey(); // may be null — fetchBases handles it via local API

  await loadSettings();

  try {
    const [bases, gamedata] = await Promise.all([fetchBases(apiKey), loadGamedata()]);
    if (!bases?.length) return;
    _loadedHeaderBases    = bases;
    _loadedHeaderGamedata = gamedata;

    removeProductionUI();

    // Spacer div as first body child — pushes the game's content down
    const spacer = document.createElement('div');
    spacer.id = GT_SPACER_ID;
    spacer.style.cssText = `height:${HEADER_H}px;width:100%;pointer-events:none;flex-shrink:0;`;
    document.body.insertBefore(spacer, document.body.firstChild);

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

    const sorted = sortBases(bases).filter(b => !_settings.hiddenBases.includes(String(b.id)));
    for (const base of sorted) {
      chipArea.appendChild(buildHeaderChip(base, gamedata));
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

    if (_settings.showWishlist) {
      let _wishArmed = false;
      let _wishTimer = null;
      const wishAllBtn = mkCtrlBtn('&#128722;', 'Create wishlists for all visible bases');
      const resetWishBtn = () => {
        _wishArmed = false;
        clearTimeout(_wishTimer);
        wishAllBtn.innerHTML = '&#128722;';
        wishAllBtn.style.fontSize = '13px';
        setCtrlActive(wishAllBtn, false);
      };
      wishAllBtn.addEventListener('click', () => {
        if (!_wishArmed) {
          _wishArmed = true;
          wishAllBtn.innerHTML = '&#10003;?';
          wishAllBtn.style.fontSize = '11px';
          setCtrlActive(wishAllBtn, true);
          _wishTimer = setTimeout(resetWishBtn, 4000);
        } else {
          clearTimeout(_wishTimer);
          resetWishBtn();
          handleWishlistAll(wishAllBtn);
        }
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

    // Keep spacer + tab + all floating panels in sync with header height
    const ro = new ResizeObserver(() => {
      if (_headerCollapsed) return;
      const h = header.offsetHeight;
      spacer.style.height = h + 'px';
      tab.style.top = h + 'px';
      [GT_DETAIL_ID, GT_SETTINGS_ID, GT_CASH_ID, GT_SUMMARY_ID].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.top = h + 'px';
      });
      syncOverflowBadge();
    });
    ro.observe(header);

    // Close panels when clicking anywhere outside the extension UI
    if (!document._gtOutsideClick) {
      document._gtOutsideClick = true;
      document.addEventListener('click', (e) => {
        const extIds = [GT_HEADER_ID, GT_DETAIL_ID, GT_SETTINGS_ID, GT_CASH_ID, GT_SUMMARY_ID, GT_TAB_ID, GT_TOAST_ID];
        const inExt = extIds.some(id => document.getElementById(id)?.contains(e.target));
        if (!inExt && (_detailBaseId || _settingsOpen || _cashOpen || _summaryOpen)) {
          document.getElementById(GT_DETAIL_ID)?.remove();   _detailBaseId = null;
          document.getElementById(GT_SETTINGS_ID)?.remove(); _settingsOpen = false;
          document.getElementById(GT_CASH_ID)?.remove();     _cashOpen     = false;
          document.getElementById(GT_SUMMARY_ID)?.remove();  _summaryOpen  = false;
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
      watchGteNav();
    }
  });
})();

chrome.storage.onChanged.addListener((changes) => {
  if (!('enabled' in changes)) return;
  if (changes.enabled.newValue === false) {
    removeProductionUI();
    document.getElementById(GT_SETTINGS_ID)?.remove();
    document.getElementById(GT_TOAST_ID)?.remove();
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
let _gteErr         = null;
let _gteExpandedMat = null;
let _gteCanWrite    = false;
let _gteSessionToken = null;
let _gteDataLoaded  = false;
let _gteSearchQ     = '';
let _gteFormMode    = null;   // 'new' | 'add-loc' | 'edit-loc'
let _gteFormCtx     = null;   // { listingId?, locId?, matId?, matName? }
let _gteNavObs      = null;

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

  if (!apiKey) throw new Error('No API key — set one in the extension popup.');

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

async function gteLoadData(forceRefresh = false) {
  if (!forceRefresh && _gteDataLoaded) { gteRenderBoth(); return; }

  _gteLoading = true; _gteErr = null;
  gteRenderBoth();

  try {
    const identity = await resolveIdentity();
    const gTag = identity?.gTag ?? '';

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
    listArea.innerHTML = '';
    if (_gteLoading) { listArea.innerHTML = '<div style="padding:24px;text-align:center;color:#4a4a6a;">Loading…</div>'; return; }
    if (_gteErr)     { listArea.innerHTML = `<div style="padding:20px;color:#ef4444;font-size:13px;">${_gteErr}</div>`; return; }

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
  }

  renderGroups();
}

function gteRenderRight() {
  const col = document.getElementById(GTE_RIGHT_ID);
  if (!col) return;
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

  // No token — prompt to set one
  if (!_gteCanWrite) {
    const noTok = document.createElement('div');
    noTok.style.cssText = 'padding:20px 14px;color:#4a4a6a;font-size:12px;line-height:1.6;';
    noTok.textContent = 'Set your game API key in the extension popup to manage your guild listings.';
    col.appendChild(noTok);
    return;
  }

  if (_gteLoading) {
    const ld = document.createElement('div');
    ld.style.cssText = 'padding:20px;text-align:center;color:#4a4a6a;';
    ld.textContent = 'Loading…';
    col.appendChild(ld);
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
  titleEl.textContent = 'Guild Trade Board';
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
  if (!document._gteEscHandler) {
    document._gteEscHandler = (e) => { if (e.key === 'Escape') closeGteModal(); };
    document.addEventListener('keydown', document._gteEscHandler);
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
    a.appendChild(document.createTextNode('GTE'));

    a.addEventListener('mouseenter', () => { iconSvg.style.opacity = '1'; });
    a.addEventListener('mouseleave', () => { iconSvg.style.opacity = '0.55'; });
    a.addEventListener('click', e => { e.preventDefault(); openGteModal(); });
    li.appendChild(a);
    navEl.appendChild(li);
  } finally {
    _gteNavInjecting = false;
  }
}

function watchGteNav() {
  injectGteNavBtn();
  if (_gteNavObs) return;
  _gteNavObs = new MutationObserver(() => {
    if (!document.getElementById(GTE_NAV_ID)) injectGteNavBtn();
  });
  _gteNavObs.observe(document.body, { childList: true, subtree: true });
}
