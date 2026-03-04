import fetch from 'node-fetch';
import pool from '../database/db.js';

const BASE    = process.env.GT_API_BASE;
const API_KEY = process.env.GT_API_KEY;

// ── Rate limiter ──────────────────────────────────────────────────────────────
// GT API budget: 500 units / 10 min with API key = 250 / 5 min. We target 230 to keep a buffer.
class RateLimiter {
  constructor(maxUnits = 230, windowMs = 5 * 60 * 1000) {
    this.maxUnits  = maxUnits;
    this.windowMs  = windowMs;
    this.usage     = []; // [{ ts, units, path }]
  }

  _prune() {
    const cutoff = Date.now() - this.windowMs;
    this.usage = this.usage.filter((u) => u.ts > cutoff);
  }

  used()      { this._prune(); return this.usage.reduce((s, u) => s + u.units, 0); }
  available() { return this.maxUnits - this.used(); }
  canAfford(units) { return this.available() >= units; }

  spend(units, path) {
    this.usage.push({ ts: Date.now(), units, path });
    console.log(`[rate] spent ${units} on ${path} — ${this.available()} remaining in window`);
  }

  status() {
    this._prune();
    const used = this.used();
    const oldest = this.usage[0];
    const resetsIn = oldest
      ? Math.max(0, Math.ceil((oldest.ts + this.windowMs - Date.now()) / 1000))
      : 0;
    return { used, available: this.maxUnits - used, max: this.maxUnits, resetsIn };
  }
}

const rl = new RateLimiter();

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
  if (!rl.canAfford(units)) {
    const err = new Error(
      `Rate budget exceeded (${rl.available()} / ${units} units needed). ` +
      `Resets in ~${rl.status().resetsIn}s.`
    );
    err.status = 429;
    err.rateLimited = true;
    throw err;
  }

  const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
  const res = await fetch(`${BASE}${path}`, { headers });

  if (res.status === 429) {
    const err = new Error('GT API returned 429 — rate limit hit at the source.');
    err.status = 429;
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`GT API ${res.status}: ${text}`), { status: res.status });
  }

  rl.spend(units, path);
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
  return rl.status();
}

// Expose rate limiter primitives so tracker.js can register its API calls
// with the shared budget — preventing double-counting against the 200-unit limit.
export function canAffordRateLimit(units) { return rl.canAfford(units); }
export function spendRateLimit(units, path) { rl.spend(units, path); }

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
