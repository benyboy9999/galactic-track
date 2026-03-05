import fetch from 'node-fetch';
import pool from '../database/db.js';

const BASE    = process.env.GT_API_BASE;
const API_KEY = process.env.GT_API_KEY;

const TOTAL_BUDGET = 500; // points per 10-min rolling window (with API key)

// ── API-driven rate limit state ───────────────────────────────────────────────
// We read `rate-remaining` and `rate-reset` headers from every GT API response
// (present on both 200 and 429). Between responses we subtract our own spend
// locally as a conservative estimate.
let rl = {
  remaining:  TOTAL_BUDGET, // last API-reported remaining (rate-remaining header)
  resetSec:   600,          // last API-reported seconds to window reset (rate-reset header)
  updatedAt:  0,            // Date.now() when we last got a header update
  ourSpend:   0,            // points WE have spent since last header update
};

function _updateFromHeaders(headers) {
  const rem   = headers.get('rate-remaining');
  const reset = headers.get('rate-reset');
  if (rem !== null) {
    rl = { remaining: Number(rem), resetSec: reset !== null ? Number(reset) : rl.resetSec, updatedAt: Date.now(), ourSpend: 0 };
  } else if (reset !== null) {
    rl.resetSec = Number(reset);
  }
}

function _estimated() {
  // If the reset window has elapsed since the last header update, the rolling
  // window has cleared — optimistically return full budget so a real call can
  // get through and refresh the actual remaining count from response headers.
  if (rl.updatedAt > 0) {
    const elapsed = (Date.now() - rl.updatedAt) / 1000;
    if (elapsed >= rl.resetSec) return TOTAL_BUDGET;
  }
  return Math.max(0, rl.remaining - rl.ourSpend);
}

// ── In-flight deduplication ───────────────────────────────────────────────────
// Ensures concurrent requests for the same key share one in-flight fetch.
const inFlight = new Map();

function withDedup(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ── Cache TTLs ────────────────────────────────────────────────────────────────
// These are deliberately conservative — the DB layer means cold starts are cheap.
const TTL = {
  gamedata:   60 * 60 * 1000,  // 60 min  (static; changes only on game updates)
  allDetails:  5 * 60 * 1000,  // 5 min   (60 units — one call per rate window max)
  prices:      3 * 60 * 1000,  // 3 min   (5 units)
  details:     5 * 60 * 1000,  // 5 min   (5 units per item)
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

// ── DB cache helpers (survives server restarts / nodemon) ─────────────────────
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
async function gtFetch(path, units) {
  if (_estimated() < units) {
    const resetIn = Math.round(Math.max(0, rl.resetSec - (Date.now() - rl.updatedAt) / 1000));
    const err = new Error(
      `Rate budget insufficient — estimated ${_estimated()} remaining (need ${units}). Resets in ~${resetIn}s.`
    );
    err.status = 429;
    err.rateLimited = true;
    throw err;
  }

  const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
  const res = await fetch(`${BASE}${path}`, { headers });

  // Always read rate limit headers — present on both 200 and 429
  _updateFromHeaders(res.headers);

  if (res.status === 429) {
    const err = new Error(
      `GT API rate limit hit — ${rl.remaining} remaining, resets in ${rl.resetSec}s.`
    );
    err.status = 429;
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`GT API ${res.status}: ${text}`), { status: res.status });
  }

  rl.ourSpend += units;
  return res.json();
}

// ── Generic resilient fetch ───────────────────────────────────────────────────
// Priority: memory cache → DB cache → live API → stale fallback on rate limit
async function resilientFetch(key, units, ttl, apiFn) {
  // 1. Memory cache
  const hot = memGet(key, ttl);
  if (hot) return hot.data;

  // 2. Deduplicate concurrent callers
  return withDedup(key, async () => {
    // Re-check after taking the "slot"
    const hot2 = memGet(key, ttl);
    if (hot2) return hot2.data;

    // 3. DB cache (warm start after restart)
    const dbRow = await dbGet(key);
    if (dbRow && Date.now() - new Date(dbRow.cached_at).getTime() < ttl) {
      console.log(`[cache] DB hit for "${key}"`);
      memSet(key, dbRow.data);
      return dbRow.data;
    }

    // 4. Live API call
    try {
      const data = await apiFn();
      memSet(key, data);
      dbSet(key, data); // fire-and-forget
      return data;
    } catch (err) {
      if (err.rateLimited) {
        // 5. Stale fallback — return whatever we have rather than erroring
        const stale = mem.get(key) ?? (dbRow ? { data: dbRow.data } : null);
        if (stale) {
          console.warn(`[rate] returning stale cache for "${key}"`);
          return stale.data;
        }
      }
      throw err;
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getRateLimitStatus() {
  const elapsed   = rl.updatedAt ? (Date.now() - rl.updatedAt) / 1000 : 0;
  const resetIn   = Math.round(Math.max(0, rl.resetSec - elapsed));
  const estimated = _estimated();
  return {
    remaining:            estimated,
    resetIn,
    totalBudget:          TOTAL_BUDGET,
    used:                 TOTAL_BUDGET - estimated,           // all sources combined
    ourSpendSinceReport:  rl.ourSpend,                        // our spend since last API header
    usedByOthers:         Math.max(0, TOTAL_BUDGET - rl.remaining - rl.ourSpend), // approx at time of last report
    lastApiRemaining:     rl.remaining,
    lastApiResetSec:      rl.resetSec,
    lastUpdated:          rl.updatedAt || null,
  };
}

// Used by tracker.js to route through the same fetch + rate state
export { gtFetch };
export function canAffordRateLimit(units) { return _estimated() >= units; }
export function spendRateLimit(units)     { rl.ourSpend += units; }

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
