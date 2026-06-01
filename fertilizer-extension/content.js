'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────
const GT_API    = 'https://api.g2.galactictycoons.com';
const PANEL_ID  = 'gt-fa-panel';
const TOGGLE_ID = 'gt-fa-toggle';
const PRICE_TTL = 5 * 60 * 1000;

// ── Recipe data (hardcoded from gamedata.json) ────────────────────────────────
// profitPerHr = (outQty / timeMin * 60) * outPrice − Σ(inQty / timeMin * 60) * inPrice
// Material IDs: Water=11, Fertilizer=36, Grain=4, Fruits=28, Vegetables=29,
//               Wood=48, Coffee Beans=51, Honeycaps=128, Herbs=156

const RECIPES = [
  {
    name: 'Grain', group: 'farm',
    base: { timeMin: 75,  out: [4,  25], inputs: [[11, 5]] },
    fert: { timeMin: 60,  out: [4,  30], inputs: [[11, 5], [36, 2]] },
  },
  {
    name: 'Fruits', group: 'farm',
    base: { timeMin: 90,  out: [28, 11], inputs: [[11, 8]] },
    fert: { timeMin: 75,  out: [28, 13], inputs: [[11, 7], [36, 2]] },
  },
  {
    name: 'Vegetables', group: 'farm',
    base: { timeMin: 75,  out: [29, 11], inputs: [[11, 9]] },
    fert: { timeMin: 90,  out: [29, 16], inputs: [[11, 10], [36, 2]] },
  },
  {
    name: 'Coffee Beans', group: 'orchard',
    base: { timeMin: 105, out: [51, 12], inputs: [[11, 10]] },
    fert: { timeMin: 75,  out: [51, 15], inputs: [[11, 11], [36, 5]] },
  },
  {
    name: 'Honeycaps', group: 'orchard',
    base: { timeMin: 75,  out: [128, 10], inputs: [[11, 13]] },
    fert: { timeMin: 75,  out: [128, 15], inputs: [[11, 16], [36, 5]] },
  },
  {
    name: 'Wood', group: 'orchard',
    base: null, // base Wood recipe is in Farm (different building type), not comparable
    fert: { timeMin: 120, out: [48, 35], inputs: [[11, 18], [36, 8]] },
    note: 'orchard only',
  },
  {
    name: 'Herbs', group: 'orchard',
    base: null,
    fert: { timeMin: 75,  out: [156, 10], inputs: [[11, 5], [36, 5]] },
    note: 'only option',
  },
];

// All recipe IDs for Farm (bldg=10) and Orchard (bldg=19) — used to count
// buildings from infinite production orders.
const FARM_RECIPE_IDS   = new Set([21, 22, 27, 28, 30, 35, 47, 60]);
const ORCHARD_RECIPE_IDS = new Set([53, 136, 140, 141, 142, 171]);

// ── Storage helpers ────────────────────────────────────────────────────────────
function getApiKey() {
  return new Promise(r => chrome.storage.local.get('gtExtApiKey', d => r(d.gtExtApiKey ?? null)));
}

// ── Price cache ────────────────────────────────────────────────────────────────
let _priceMap = null, _priceTs = 0;

async function fetchPrices() {
  if (_priceMap && Date.now() - _priceTs < PRICE_TTL) return _priceMap;
  try {
    const key = await getApiKey();
    const url = `${GT_API}/public/exchange/mat-prices${key ? `?apikey=${encodeURIComponent(key)}` : ''}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    const arr = data.prices ?? (Array.isArray(data) ? data : []);
    const map = new Map();
    for (const p of arr) {
      const id    = Number(p.matId ?? p.id);
      const cents = p.currentPrice ?? p.avgPrice ?? p.minSell ?? p.price ?? 0;
      if (id && cents > 0) map.set(id, cents / 100);
    }
    if (map.size > 0) { _priceMap = map; _priceTs = Date.now(); }
    return _priceMap;
  } catch { return _priceMap ?? null; }
}

// ── Building count cache ───────────────────────────────────────────────────────
let _buildCounts = null, _buildTs = 0;

async function fetchBuildingCounts() {
  if (_buildCounts && Date.now() - _buildTs < PRICE_TTL) return _buildCounts;
  try {
    const key = await getApiKey();
    if (!key) return { farm: 0, orchard: 0 };
    const r = await fetch(`${GT_API}/public/company?apikey=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    let farm = 0, orchard = 0;
    for (const base of data.bases ?? []) {
      for (const order of base.productionOrders ?? []) {
        if (order.amt !== 65535) continue; // infinite orders only
        if (FARM_RECIPE_IDS.has(order.rId))    farm++;
        else if (ORCHARD_RECIPE_IDS.has(order.rId)) orchard++;
      }
    }
    _buildCounts = { farm, orchard };
    _buildTs = Date.now();
    return _buildCounts;
  } catch { return { farm: 0, orchard: 0 }; }
}

// ── Calculation ────────────────────────────────────────────────────────────────
function profitPerHr(recipe, prices) {
  const [outId, outQty] = recipe.out;
  const outPhr = (outQty / recipe.timeMin * 60) * (prices.get(outId) ?? 0);
  let inputPhr = 0;
  for (const [id, qty] of recipe.inputs) {
    inputPhr += (qty / recipe.timeMin * 60) * (prices.get(id) ?? 0);
  }
  return outPhr - inputPhr;
}

// ── Panel render ───────────────────────────────────────────────────────────────
async function renderPanel() {
  const content  = document.getElementById('gt-fa-content');
  const fertEl   = document.getElementById('gt-fa-fert-price');
  const updEl    = document.getElementById('gt-fa-updated');
  if (!content) return;

  content.innerHTML = '<div style="color:#6b6b8a;font-size:11px;padding:6px 0 2px;">Loading…</div>';
  if (fertEl) fertEl.textContent = 'Fertilizer: loading…';

  const [prices, counts] = await Promise.all([fetchPrices(), fetchBuildingCounts()]);

  if (!prices) {
    content.innerHTML = `<div style="color:#ef4444;font-size:11px;line-height:1.5;padding:4px 0;">
      Prices unavailable.<br><span style="color:#6b6b8a;">Add API key via the main GT extension ⚙ panel.</span>
    </div>`;
    if (fertEl) fertEl.textContent = 'Fertilizer: —';
    return;
  }

  const fertPrice = prices.get(36) ?? 0;
  if (fertEl) {
    fertEl.textContent = fertPrice > 0
      ? `Fertilizer: $${Math.round(fertPrice).toLocaleString()}/unit`
      : 'Fertilizer: no price data';
  }

  content.innerHTML = '';

  const mkSection = (label, recs, count, countLabel) => {
    const sec = document.createElement('div');
    sec.style.cssText = 'margin-bottom:6px;';

    const secHdr = document.createElement('div');
    secHdr.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;';
    const secTitle = document.createElement('span');
    secTitle.style.cssText = 'color:#6b6b8a;font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
    secTitle.textContent = label;
    const secCount = document.createElement('span');
    secCount.style.cssText = 'color:#4a4a6a;font-size:10px;';
    secCount.textContent = count > 0 ? `×${count} ${countLabel}` : '';
    secHdr.appendChild(secTitle);
    secHdr.appendChild(secCount);
    sec.appendChild(secHdr);

    for (const recipe of recs) {
      const basePhr = recipe.base ? profitPerHr(recipe.base, prices) : null;
      const fertPhr = profitPerHr(recipe.fert, prices);
      const multiplier = Math.max(count, 1);

      let indicator, indicatorColor, gainText, gainTitle = '';

      if (basePhr !== null) {
        const gainPerBldg = fertPhr - basePhr;
        const totalGain   = gainPerBldg * multiplier;
        indicator      = totalGain > 0 ? '✓' : '✗';
        indicatorColor = totalGain > 0 ? '#22c55e' : '#ef4444';
        const sign = totalGain >= 0 ? '+' : '';
        gainText = `${sign}$${Math.abs(Math.round(totalGain)).toLocaleString()}/hr`;
        if (count > 1) {
          const s2 = gainPerBldg >= 0 ? '+' : '';
          gainTitle = `Per building: ${s2}$${Math.abs(Math.round(gainPerBldg)).toLocaleString()}/hr`;
        }
      } else {
        const total = fertPhr * multiplier;
        indicator      = '—';
        indicatorColor = '#6b6b8a';
        gainText = `$${Math.round(total).toLocaleString()}/hr`;
        if (count > 1) gainTitle = `Per building: $${Math.round(fertPhr).toLocaleString()}/hr`;
      }

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:2px 0;';
      if (gainTitle) row.title = gainTitle;

      const ind = document.createElement('span');
      ind.style.cssText = `color:${indicatorColor};font-size:12px;font-weight:700;width:11px;flex-shrink:0;text-align:center;`;
      ind.textContent = indicator;

      const name = document.createElement('span');
      name.style.cssText = 'flex:1;color:#c0c0da;font-size:12px;';
      name.textContent = recipe.name;

      const gainEl = document.createElement('span');
      gainEl.style.cssText = `color:${indicatorColor};font-size:11px;text-align:right;flex-shrink:0;`;
      gainEl.textContent = gainText;

      row.appendChild(ind);
      row.appendChild(name);

      if (recipe.note) {
        const noteEl = document.createElement('span');
        noteEl.style.cssText = 'color:#4a4a6a;font-size:10px;flex-shrink:0;';
        noteEl.textContent = recipe.note;
        row.appendChild(noteEl);
      }

      row.appendChild(gainEl);
      sec.appendChild(row);
    }

    content.appendChild(sec);
  };

  mkSection('Farm', RECIPES.filter(r => r.group === 'farm'), counts.farm, 'farms');

  const sep = document.createElement('div');
  sep.style.cssText = 'border-top:1px solid #1a1a30;margin:4px 0 6px;';
  content.appendChild(sep);

  mkSection('Orchard', RECIPES.filter(r => r.group === 'orchard'), counts.orchard, 'orchards');

  if (updEl) updEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ── Draggable ──────────────────────────────────────────────────────────────────
function makeDraggable(el, handle) {
  let ox, oy, startLeft, startTop;
  handle.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    el.style.bottom = 'auto'; el.style.right = 'auto';
    el.style.top  = rect.top  + 'px';
    el.style.left = rect.left + 'px';
    ox = e.clientX; oy = e.clientY;
    startLeft = rect.left; startTop = rect.top;

    const onMove = (e) => {
      el.style.left = (startLeft + e.clientX - ox) + 'px';
      el.style.top  = (startTop  + e.clientY - oy) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      chrome.storage.local.set({ gtFaPos: { left: parseInt(el.style.left), top: parseInt(el.style.top) } });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Panel ──────────────────────────────────────────────────────────────────────
function buildPanel(savedPos, savedCollapsed) {
  document.getElementById(PANEL_ID)?.remove();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed',
    savedPos ? `top:${savedPos.top}px;left:${savedPos.left}px` : 'bottom:64px;right:20px',
    'width:270px',
    'background:#0a0a18', 'border:1px solid #2a2a4a', 'border-radius:8px',
    'font-family:system-ui,sans-serif', 'font-size:12px', 'color:#b0b0cc',
    'box-shadow:0 4px 20px rgba(0,0,0,0.7)',
    'z-index:2147483640',
    'overflow:hidden',
  ].join(';');

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid #1a1a30;cursor:move;background:#111128;';

  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'font-size:12px;font-weight:600;color:#c0c0da;';
  titleEl.textContent = '🌱 Fertilizer Advisor';

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;align-items:center;gap:2px;';

  const mkHdrBtn = (text, title) => {
    const b = document.createElement('button');
    b.textContent = text; b.title = title;
    b.style.cssText = 'background:none;border:none;color:#6b6b8a;cursor:pointer;font-size:14px;padding:2px 4px;line-height:1;border-radius:3px;';
    b.addEventListener('mouseenter', () => { b.style.color = '#d8d8f0'; });
    b.addEventListener('mouseleave', () => { b.style.color = '#6b6b8a'; });
    return b;
  };

  const refreshBtn  = mkHdrBtn('↻', 'Refresh prices');
  const collapseBtn = mkHdrBtn(savedCollapsed ? '+' : '–', 'Toggle');
  const closeBtn    = mkHdrBtn('×', 'Close');

  btns.appendChild(refreshBtn);
  btns.appendChild(collapseBtn);
  btns.appendChild(closeBtn);
  hdr.appendChild(titleEl);
  hdr.appendChild(btns);
  panel.appendChild(hdr);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'padding:8px 10px 10px;';
  if (savedCollapsed) body.style.display = 'none';

  // Fert price row
  const fertEl = document.createElement('div');
  fertEl.id = 'gt-fa-fert-price';
  fertEl.style.cssText = 'font-size:11px;color:#6b6b8a;padding-bottom:5px;border-bottom:1px solid #1a1a30;margin-bottom:6px;';
  fertEl.textContent = 'Fertilizer: —';
  body.appendChild(fertEl);

  // Content
  const content = document.createElement('div');
  content.id = 'gt-fa-content';
  body.appendChild(content);

  // Updated timestamp
  const updEl = document.createElement('div');
  updEl.id = 'gt-fa-updated';
  updEl.style.cssText = 'color:#2a2a4a;font-size:10px;text-align:right;margin-top:5px;';
  body.appendChild(updEl);

  panel.appendChild(body);
  document.body.appendChild(panel);
  makeDraggable(panel, hdr);

  // ── Button handlers ────────────────────────────────────────────────────────
  let collapsed = savedCollapsed ?? false;

  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    collapseBtn.textContent = collapsed ? '+' : '–';
    chrome.storage.local.set({ gtFaCollapsed: collapsed });
  });

  refreshBtn.addEventListener('click', async () => {
    _priceMap = null; _priceTs = 0;
    _buildCounts = null; _buildTs = 0;
    await renderPanel();
  });

  closeBtn.addEventListener('click', () => {
    panel.remove();
    chrome.storage.local.set({ gtFaOpen: false });
    buildToggle();
  });
}

// ── Toggle button ──────────────────────────────────────────────────────────────
function buildToggle() {
  document.getElementById(TOGGLE_ID)?.remove();

  const btn = document.createElement('button');
  btn.id    = TOGGLE_ID;
  btn.title = 'GT Fertilizer Advisor';
  btn.textContent = '🌱';
  btn.style.cssText = [
    'position:fixed', 'bottom:20px', 'right:20px',
    'width:34px', 'height:34px',
    'background:#111128', 'border:1px solid #2a2a4a', 'border-radius:7px',
    'font-size:16px', 'cursor:pointer', 'padding:0',
    'z-index:2147483640',
    'box-shadow:0 2px 8px rgba(0,0,0,0.5)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'transition:border-color 0.15s',
  ].join(';');
  btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4a4a6a'; });
  btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a2a4a'; });
  btn.addEventListener('click', async () => {
    btn.remove();
    chrome.storage.local.set({ gtFaOpen: true, gtFaCollapsed: false });
    buildPanel(null, false);
    await renderPanel();
  });

  document.body.appendChild(btn);
}

// ── Init ───────────────────────────────────────────────────────────────────────
(async () => {
  const { gtFaOpen, gtFaCollapsed, gtFaPos } = await new Promise(r =>
    chrome.storage.local.get(['gtFaOpen', 'gtFaCollapsed', 'gtFaPos'], r)
  );

  if (gtFaOpen) {
    buildPanel(gtFaPos ?? null, gtFaCollapsed ?? false);
    await renderPanel();
  } else {
    buildToggle();
  }
})();
