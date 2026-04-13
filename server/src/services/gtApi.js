import fetch from 'node-fetch';
import pool from '../database/db.js';

const BASE = process.env.GT_API_BASE;

const TOTAL_BUDGET  = 500;  // points per 10-min window for regular keys
const MASTER_BUDGET = 2500; // elevated budget for the master key
export const MASTER_KEY = process.env.GT_MASTER_API_KEY ?? null;

function _budget(apiKey) {
  return (MASTER_KEY && apiKey === MASTER_KEY) ? MASTER_BUDGET : TOTAL_BUDGET;
}

// ── Per-key rate limit state ───────────────────────────────────────────────────
// Each API key has its own independent budget tracked in memory.
const rlMap = new Map(); // apiKey → { remaining, resetSec, updatedAt, ourSpend }

function getRl(apiKey) {
  if (!rlMap.has(apiKey)) {
    rlMap.set(apiKey, { remaining: _budget(apiKey), resetSec: 600, updatedAt: 0, ourSpend: 0 });
  }
  return rlMap.get(apiKey);
}

function _updateFromHeaders(apiKey, headers) {
  const rl    = getRl(apiKey);
  const rem   = headers.get('rate-remaining');
  const reset = headers.get('rate-reset');
  if (rem !== null) {
    rlMap.set(apiKey, { remaining: Number(rem), resetSec: reset !== null ? Number(reset) : rl.resetSec, updatedAt: Date.now(), ourSpend: 0 });
  } else if (reset !== null) {
    rl.resetSec = Number(reset);
  }
}

function _estimated(apiKey) {
  const rl = getRl(apiKey);
  // If the reset window has elapsed, optimistically return full budget so a real
  // call can get through and refresh the actual remaining count from headers.
  if (rl.updatedAt > 0) {
    const elapsed = (Date.now() - rl.updatedAt) / 1000;
    if (elapsed >= rl.resetSec) return _budget(apiKey);
  }
  return Math.max(0, rl.remaining - rl.ourSpend);
}

// ── In-flight deduplication ───────────────────────────────────────────────────
const inFlight = new Map();

function withDedup(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ── Cache TTLs ────────────────────────────────────────────────────────────────
const TTL = {
  gamedata:   60 * 60 * 1000,  // 60 min
  allDetails:  5 * 60 * 1000,  // 5 min
  prices:      3 * 60 * 1000,  // 3 min
  details:     5 * 60 * 1000,  // 5 min
};

// ── Memory cache ──────────────────────────────────────────────────────────────
const mem = new Map(); // key → { data, ts }

function memGet(key, ttl) {
  const entry = mem.get(key);
  return entry && Date.now() - entry.ts < ttl ? entry : null;
}

function memSet(key, data) {
  mem.set(key, { data, ts: Date.now() });
}

// ── DB cache helpers ──────────────────────────────────────────────────────────
async function dbGet(key) {
  try {
    const r = await pool.query('SELECT data, cached_at FROM game_data_cache WHERE key=$1', [key]);
    return r.rows[0] ?? null;
  } catch { return null; }
}

async function dbSet(key, data) {
  try {
    await pool.query(
      `INSERT INTO game_data_cache(key, data, cached_at) VALUES($1,$2,NOW())
       ON CONFLICT(key) DO UPDATE SET data=$2, cached_at=NOW()`,
      [key, data]
    );
  } catch { /* DB unavailable — non-fatal */ }
}

// ── Core fetch ────────────────────────────────────────────────────────────────
// apiKey defaults to the env-var fallback for non-tracker routes.
async function gtFetch(path, units, apiKey = null) {
  if (_estimated(apiKey) < units) {
    const rl = getRl(apiKey);
    const resetIn = Math.round(Math.max(0, rl.resetSec - (Date.now() - rl.updatedAt) / 1000));
    const err = new Error(
      `Rate budget insufficient — estimated ${_estimated(apiKey)} remaining (need ${units}). Resets in ~${resetIn}s.`
    );
    err.status = 429;
    err.rateLimited = true;
    throw err;
  }

  const url = `${BASE}${path}${apiKey ? `${path.includes('?') ? '&' : '?'}apikey=${apiKey}` : ''}`;
  const res = await fetch(url);

  _updateFromHeaders(apiKey, res.headers);

  if (res.status === 429) {
    const rl = getRl(apiKey);
    const err = new Error(`GT API rate limit hit — ${rl.remaining} remaining, resets in ${rl.resetSec}s.`);
    err.status = 429;
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`GT API ${res.status}: ${text}`), { status: res.status });
  }

  getRl(apiKey).ourSpend += units;
  return res.json();
}

// ── Generic resilient fetch ───────────────────────────────────────────────────
async function resilientFetch(cacheKey, units, ttl, apiFn) {
  const hot = memGet(cacheKey, ttl);
  if (hot) return hot.data;

  return withDedup(cacheKey, async () => {
    const hot2 = memGet(cacheKey, ttl);
    if (hot2) return hot2.data;

    const dbRow = await dbGet(cacheKey);
    if (dbRow && Date.now() - new Date(dbRow.cached_at).getTime() < ttl) {
      console.log(`[cache] DB hit for "${cacheKey}"`);
      memSet(cacheKey, dbRow.data);
      return dbRow.data;
    }

    try {
      const data = await apiFn();
      memSet(cacheKey, data);
      dbSet(cacheKey, data);
      return data;
    } catch (err) {
      if (err.rateLimited) {
        const stale = mem.get(cacheKey) ?? (dbRow ? { data: dbRow.data } : null);
        if (stale) {
          console.warn(`[rate] returning stale cache for "${cacheKey}"`);
          return stale.data;
        }
      }
      throw err;
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

// Returns rate limit status for one key (or the env fallback key).
export function getRateLimitStatus(apiKey = null) {
  const rl = getRl(apiKey);
  const elapsed = rl.updatedAt ? (Date.now() - rl.updatedAt) / 1000 : 0;
  return {
    remaining:   rl.remaining,
    resetIn:     Math.round(Math.max(0, rl.resetSec - elapsed)),
    totalBudget: _budget(apiKey),
  };
}

// Returns rate status for every key currently in the map (for admin panel).
export function getRateLimitStatusAll() {
  const out = [];
  for (const [apiKey, rl] of rlMap) {
    const elapsed = rl.updatedAt ? (Date.now() - rl.updatedAt) / 1000 : 0;
    out.push({
      apiKey,   // will be joined with company name in admin route
      remaining:   rl.remaining,
      resetIn:     Math.round(Math.max(0, rl.resetSec - elapsed)),
      totalBudget: _budget(apiKey),
    });
  }
  return out;
}

// Validate a user's API key and return their company info.
export async function getCompanyInfo(apiKey) {
  const res = await fetch(`${BASE}/public/company?apikey=${apiKey}`);
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Invalid or revoked API key'), { status: res.status });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`GT API ${res.status}`), { status: res.status });
  }
  return res.json();
}

// Fetch full company detail (logo + guild tag). Costs 12 units from the caller's key.
export async function getCompanyDetail(companyId, apiKey) {
  return gtFetch(`/public/company/${companyId}/detail`, 12, apiKey);
}

export { gtFetch };
export function canAffordRateLimit(units, apiKey = null) { return _estimated(apiKey) >= units; }
export function spendRateLimit(units, apiKey = null)     { getRl(apiKey).ourSpend += units; }

export async function getGameData() {
  return resilientFetch('gamedata', 1, TTL.gamedata, async () => {
    return gtFetch('/gamedata.json', 1);
  });
}

export async function getAllPrices() {
  return resilientFetch('all-prices', 5, TTL.prices, async () => {
    const json = await gtFetch('/public/exchange/mat-prices', 5);
    const data = Array.isArray(json) ? json : (json.prices ?? []);
    storePriceSnapshot(data).catch(() => {});
    return data;
  });
}

export async function getAllDetails() {
  return resilientFetch('all-details', 60, TTL.allDetails, async () => {
    const json = await gtFetch('/public/exchange/mat-details', 60);
    const materials = Array.isArray(json) ? json : (json.materials ?? []);
    const data = materials.map(enrichWithSupplyMetrics);
    storePriceSnapshot(data).catch(() => {});
    return data;
  });
}

export async function getMatDetails(matId) {
  return resilientFetch(`details-${matId}`, 5, TTL.details, async () => {
    return gtFetch(`/public/exchange/mat-details/${matId}`, 5);
  });
}

// ── Supply metrics ────────────────────────────────────────────────────────────

function enrichWithSupplyMetrics(mat) {
  const history = mat.priceHistory ?? [];
  const today   = new Date().toISOString().slice(0, 10);
  const fullDays = history.filter((h) => h.date !== today).slice(0, 7);

  const dailyDeltas = [];
  for (let i = 0; i < fullDays.length - 1; i++) {
    dailyDeltas.push(fullDays[i].qtyRemaining - fullDays[i + 1].qtyRemaining);
  }

  let weightedSum = 0, totalWeight = 0;
  dailyDeltas.forEach((d, i) => {
    const w = fullDays.length - i;
    weightedSum += d * w;
    totalWeight += w;
  });
  const avgDailyChange = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  const daysRemaining = mat.avgQtySoldDaily > 0
    ? +(mat.totalQtyAvailable / mat.avgQtySoldDaily).toFixed(1)
    : null;

  const threshold  = Math.max(5000, (mat.totalQtyAvailable ?? 0) * 0.01);
  const supplySignal =
    avgDailyChange < -threshold ? 'draining_fast' :
    avgDailyChange < -1000      ? 'draining'      :
    avgDailyChange > threshold  ? 'growing'        : 'stable';

  const sparkline = [...fullDays].reverse().map((h) => h.avgPrice);

  return { ...mat, avgDailyChange, daysRemaining, supplySignal, sparkline };
}

// ── Price snapshots ───────────────────────────────────────────────────────────

async function storePriceSnapshot(prices) {
  const client = await pool.connect();
  try {
    for (const p of prices) {
      await client.query(
        `INSERT INTO price_snapshots(mat_id, mat_name, current_price, avg_price)
         VALUES($1,$2,$3,$4)`,
        [p.matId, p.matName, p.currentPrice, p.avgPrice]
      );
    }
  } finally {
    client.release();
  }
}

// ── Sprite URL discovery ──────────────────────────────────────────────────────
// The game's SVG sprite has a content-hash filename that changes on deploys.
// We auto-discover it: HTML → main JS URL → sprite filename. Cached 1 hour.

const GAME_ORIGIN = 'https://g2.galactictycoons.com';
let spriteCache = null; // { url, ts }
const SPRITE_TTL = 60 * 60 * 1000;

export async function getSpriteUrl() {
  if (spriteCache && Date.now() - spriteCache.ts < SPRITE_TTL) {
    return spriteCache.url;
  }
  try {
    const html    = await fetch(GAME_ORIGIN).then((r) => r.text());
    const mainJs  = html.match(/\/assets\/main-[^"']+\.js/)?.[0];
    if (!mainJs) throw new Error('main JS not found in HTML');

    const js      = await fetch(GAME_ORIGIN + mainJs).then((r) => r.text());
    const sprite  = js.match(/sprite-[A-Za-z0-9_-]+\.svg/)?.[0];
    if (!sprite) throw new Error('sprite filename not found in JS');

    const url = `${GAME_ORIGIN}/assets/${sprite}`;
    spriteCache = { url, ts: Date.now() };
    console.log(`[sprite] discovered: ${url}`);
    return url;
  } catch (err) {
    console.warn('[sprite] discovery failed:', err.message);
    return null;
  }
}

export async function getPriceHistory(matId, days = 30) {
  const res = await pool.query(
    `SELECT date_trunc('hour', recorded_at) AS hour,
            AVG(current_price)::int AS avg_price,
            MIN(current_price) AS min_price,
            MAX(current_price) AS max_price
     FROM price_snapshots
     WHERE mat_id = $1
       AND current_price > 0
       AND recorded_at > NOW() - INTERVAL '${days} days'
     GROUP BY hour
     ORDER BY hour ASC`,
    [matId]
  );
  return res.rows;
}
