/**
 * Market Tracker Service
 *
 * Polls mat-details every 60 seconds for tracked items.
 * Diffs consecutive order books to classify changes as:
 *   new_listing  — order_id appears for first time
 *   restocked    — existing order's qty increased
 *   partial_fill — qty decreased AND no cheaper orders exist → inferred sale
 *   full_fill    — order disappeared AND no cheaper orders exist → inferred sale
 *   cancelled    — qty decreased or disappeared BUT cheaper orders still present
 *
 * Rate budget: 5 items × 5 units = 25 units/poll.
 * At 60s intervals that's 5 polls/5-min = 125 units/window for tracker alone.
 * GT API limit: 500/10min = 250/5min. Internal budget target: 230/5min.
 * Remaining headroom for user routes: ~105 units (allDetails=60, prices=5, etc.).
 *
 * All API calls go through the shared RateLimiter from gtApi.js so the
 * /api/ratelimit indicator stays accurate.
 */

import fetch from 'node-fetch';
import pool from '../database/db.js';
import { spendRateLimit, canAffordRateLimit } from './gtApi.js';

const BASE    = process.env.GT_API_BASE;
const API_KEY = process.env.GT_API_KEY;

// ── Game price increment lookup ────────────────────────────────────────────────
// Prices stored in cents (unitPrice × 100). Increments match GT exchange tiers.
function gameIncrement(priceCents) {
  if (priceCents <    5_000) return       50; // < $50   → $0.50
  if (priceCents <   10_000) return      100; // < $100  → $1
  if (priceCents <   50_000) return      500; // < $500  → $5
  if (priceCents <  100_000) return    1_000; // < $1000 → $10
  if (priceCents <  500_000) return    5_000; // < $5000 → $50
  if (priceCents < 1_000_000) return  10_000; // < $10k  → $100
  if (priceCents < 5_000_000) return  50_000; // < $50k  → $500
  return 100_000;                             // ≥ $50k  → $1000
}

// ── Items to track ─────────────────────────────────────────────────────────────

const TRACKED_ITEMS = [
  { matId: 2,  matName: 'Iron'       },
  { matId: 3,  matName: 'Concrete'   },
  { matId: 8,  matName: 'Silica'     },
  { matId: 34, matName: 'Limestone'  },
  { matId: 92, matName: 'Prefab Kit' },
];

const POLL_INTERVAL_MS = 60_000;
const UNITS_PER_ITEM   = 5;

let intervalHandle = null;
let lastError      = null;
let pollCount      = 0;
let lastPollAt     = null;

// ── API fetch ──────────────────────────────────────────────────────────────────

async function fetchMatDetails(matId) {
  if (!canAffordRateLimit(UNITS_PER_ITEM)) {
    throw Object.assign(
      new Error(`Rate budget insufficient for tracker poll (need ${UNITS_PER_ITEM} units)`),
      { rateLimited: true }
    );
  }

  const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
  const res = await fetch(`${BASE}/public/exchange/mat-details/${matId}`, { headers });

  if (res.status === 429) {
    throw Object.assign(new Error('GT API 429 — tracker backing off'), { rateLimited: true });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GT API ${res.status} for matId ${matId}: ${text}`);
  }

  spendRateLimit(UNITS_PER_ITEM, `/public/exchange/mat-details/${matId}`);
  return res.json();
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function getLastSnapshot(matId) {
  const r = await pool.query(
    `SELECT s.id, s.total_qty_available, s.recorded_at,
            s.api_qty_sold, s.api_qty_sold_date,
            COALESCE(json_agg(json_build_object(
              'orderId',     o.order_id,
              'companyId',   o.company_id,
              'companyName', o.company_name,
              'unitPrice',   o.unit_price,
              'qty',         o.qty
            ) ORDER BY o.unit_price ASC, o.qty DESC) FILTER (WHERE o.order_id IS NOT NULL), '[]') AS orders
     FROM tracker_snapshots s
     LEFT JOIN tracker_orders o ON o.snapshot_id = s.id
     WHERE s.mat_id = $1
     GROUP BY s.id
     ORDER BY s.recorded_at DESC
     LIMIT 1`,
    [matId]
  );
  return r.rows[0] ?? null;
}

async function saveSnapshot(client, matData, apiQtySold, apiQtySoldDate) {
  const { matId, matName, currentPrice, avgPrice, totalQtyAvailable, orders = [] } = matData;

  const snapRes = await client.query(
    `INSERT INTO tracker_snapshots(mat_id, mat_name, current_price, avg_price, total_qty_available, api_qty_sold, api_qty_sold_date)
     VALUES($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [matId, matName, currentPrice, avgPrice, totalQtyAvailable, apiQtySold ?? null, apiQtySoldDate ?? null]
  );
  const snapId = snapRes.rows[0].id;

  for (const o of orders) {
    await client.query(
      `INSERT INTO tracker_orders(snapshot_id, order_id, company_id, company_name, unit_price, qty)
       VALUES($1, $2, $3, $4, $5, $6)`,
      [snapId, o.id, o.cId, o.cName, o.unitPrice, o.qty]
    );
  }

  return snapId;
}

async function saveEvents(client, events) {
  for (const e of events) {
    await client.query(
      `INSERT INTO tracker_events(mat_id, order_id, company_id, company_name, unit_price, qty_change, event_type, snapshot_a_id, snapshot_b_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.matId, e.orderId, e.companyId, e.companyName, e.unitPrice, e.qtyChange, e.eventType, e.snapshotAId ?? null, e.snapshotBId]
    );
  }
}

// ── Diff logic ─────────────────────────────────────────────────────────────────
//
// Sale rule: an order change is only a SALE if no cheaper orders exist in the
// current (B) snapshot. Buyers always buy the cheapest listing first, so if
// cheaper listings are still there untouched, buyers haven't reached this price
// level — any qty decrease must be a cancellation/adjustment.

function diffOrderBooks(prevOrders, currOrders, matId, snapshotAId, snapshotBId) {
  const prevMap = new Map(prevOrders.map((o) => [o.orderId, o]));
  const currMap = new Map(currOrders.map((o) => [o.orderId, o]));

  const events = [];

  // ── Changes to existing orders ────────────────────────────────────────────
  for (const [orderId, prev] of prevMap) {
    const curr = currMap.get(orderId);

    // Are there any orders cheaper than this one still present in snapshot B?
    const cheaperStillExists = currOrders.some((o) => o.unitPrice < prev.unitPrice);

    if (!curr) {
      // Order disappeared entirely
      events.push({
        matId, orderId,
        companyId:   prev.companyId,
        companyName: prev.companyName,
        unitPrice:   prev.unitPrice,
        qtyChange:   -prev.qty,
        eventType:   cheaperStillExists ? 'cancelled' : 'full_fill',
        snapshotAId, snapshotBId,
      });
    } else if (curr.qty < prev.qty) {
      // Qty decreased — sale or cancellation depending on price position
      events.push({
        matId, orderId,
        companyId:   prev.companyId,
        companyName: prev.companyName,
        unitPrice:   prev.unitPrice,
        qtyChange:   -(prev.qty - curr.qty),
        eventType:   'partial_fill', // partial qty decrease is always a sale — game only allows full-listing cancellations
        snapshotAId, snapshotBId,
      });
    } else if (curr.qty > prev.qty) {
      // Qty increased — seller added more stock to existing order
      events.push({
        matId, orderId,
        companyId:   prev.companyId,
        companyName: prev.companyName,
        unitPrice:   prev.unitPrice,
        qtyChange:   curr.qty - prev.qty,
        eventType:   'restocked',
        snapshotAId, snapshotBId,
      });
    }
    // qty unchanged → nothing to record
  }

  // ── New listings ──────────────────────────────────────────────────────────
  for (const [orderId, curr] of currMap) {
    if (!prevMap.has(orderId)) {
      events.push({
        matId, orderId,
        companyId:   curr.companyId,
        companyName: curr.companyName,
        unitPrice:   curr.unitPrice,
        qtyChange:   curr.qty,
        eventType:   'new_listing',
        snapshotAId, snapshotBId,
      });
    }
  }

  return events;
}

// ── Poll one item ──────────────────────────────────────────────────────────────

async function pollItem(item) {
  const data = await fetchMatDetails(item.matId);

  // Extract intra-day qtySold accumulator from priceHistory
  const todayHistory   = data.priceHistory?.[0] ?? null;
  const apiQtySold     = todayHistory?.qtySold     ?? null;
  const apiQtySoldDate = todayHistory?.date         ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prevSnap = await getLastSnapshot(item.matId);
    const snapId   = await saveSnapshot(client, data, apiQtySold, apiQtySoldDate);

    let attributedSold = 0;

    if (prevSnap && prevSnap.orders) {
      const prevOrders = prevSnap.orders.map((o) => ({
        orderId:     o.orderId,
        companyId:   o.companyId,
        companyName: o.companyName,
        unitPrice:   o.unitPrice,
        qty:         Number(o.qty),
      }));

      const currOrders = (data.orders ?? []).map((o) => ({
        orderId:     o.id,
        companyId:   o.cId,
        companyName: o.cName,
        unitPrice:   o.unitPrice,
        qty:         o.qty,
      }));

      const events = diffOrderBooks(prevOrders, currOrders, item.matId, prevSnap.id, snapId);

      if (events.length > 0) {
        await saveEvents(client, events);

        const sales     = events.filter((e) => e.eventType === 'partial_fill' || e.eventType === 'full_fill');
        const newList   = events.filter((e) => e.eventType === 'new_listing');
        const cancelled = events.filter((e) => e.eventType === 'cancelled');
        const restocked = events.filter((e) => e.eventType === 'restocked');

        attributedSold               = sales.reduce((s, e) => s + Math.abs(e.qtyChange), 0);
        const qtyListed    = newList.reduce((s, e) => s + e.qtyChange, 0) +
                             restocked.reduce((s, e) => s + e.qtyChange, 0);
        const qtyCancelled = cancelled.reduce((s, e) => s + Math.abs(e.qtyChange), 0);

        const parts = [];
        if (attributedSold) parts.push(`${attributedSold.toLocaleString()} sold`);
        if (qtyListed)      parts.push(`${qtyListed.toLocaleString()} listed`);
        if (qtyCancelled)   parts.push(`${qtyCancelled.toLocaleString()} cancelled`);
        if (parts.length)   console.log(`[tracker] ${item.matName}: ${parts.join(', ')}`);
      }
    }

    // ── Flash sale reconciliation ─────────────────────────────────────────────
    // Compare intra-day API qtySold delta against diff-attributed sales.
    // Skip if: dates differ (day rollover), either value is null, or window > 90s
    // (missed poll would inflate the gap).
    if (
      prevSnap &&
      prevSnap.api_qty_sold      !== null &&
      apiQtySold                 !== null &&
      prevSnap.api_qty_sold_date === apiQtySoldDate
    ) {
      const windowMs  = Date.now() - new Date(prevSnap.recorded_at).getTime();
      if (windowMs <= 150_000) {
        const deltaSold = apiQtySold - Number(prevSnap.api_qty_sold);
        const flash     = Math.max(0, deltaSold - attributedSold);
        if (flash > 0) {
          await client.query(
            `UPDATE tracker_snapshots SET flash_qty = $1 WHERE id = $2`,
            [flash, snapId]
          );
          console.log(`[tracker] ${item.matName}: ${flash.toLocaleString()} flash (unattributed) sales`);
        }
      }
    }

    // ── Quick sell price ──────────────────────────────────────────────────────
    // Find first price tier that would take >1hr to clear at 6h avg sales rate.
    // quick_sell_price = that tier's price - 1 (1 increment below the wall).
    const qspSalesRes = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
               THEN ABS(qty_change) ELSE 0 END), 0)::bigint AS sold
       FROM tracker_events
       WHERE mat_id = $1 AND recorded_at > NOW() - INTERVAL '6 hours'`,
      [item.matId]
    );
    const hourly_rate = Number(qspSalesRes.rows[0].sold) / 6;

    if (hourly_rate > 0) {
      const priceMap = new Map();
      for (const o of data.orders ?? []) {
        priceMap.set(Number(o.unitPrice), (priceMap.get(Number(o.unitPrice)) ?? 0) + Number(o.qty));
      }
      const tiers = [...priceMap.entries()].sort(([a], [b]) => a - b);
      let quick_sell_price = null;
      for (const [price, tierQty] of tiers) {
        if (tierQty / hourly_rate > 1) {
          quick_sell_price = price - gameIncrement(price);
          break;
        }
      }
      if (quick_sell_price !== null) {
        await client.query(
          `UPDATE tracker_snapshots SET quick_sell_price = $1 WHERE id = $2`,
          [quick_sell_price, snapId]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Poll cycle ─────────────────────────────────────────────────────────────────

async function pollAll() {
  lastPollAt = new Date().toISOString();
  pollCount++;
  for (const item of TRACKED_ITEMS) {
    try {
      await pollItem(item);
    } catch (err) {
      if (err.rateLimited) {
        console.warn(`[tracker] rate limited — skipping ${item.matName} this cycle`);
      } else {
        lastError = { item: item.matName, message: err.message, at: new Date().toISOString() };
        console.error(`[tracker] error for ${item.matName}:`, err.message);
      }
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function startTracker() {
  console.log(`[tracker] starting — polling ${TRACKED_ITEMS.map((i) => i.matName).join(', ')} every ${POLL_INTERVAL_MS / 1000}s`);
  pollAll();
  intervalHandle = setInterval(pollAll, POLL_INTERVAL_MS);
}

export function stopTracker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function getTrackerStatus() {
  return {
    running:    intervalHandle !== null,
    items:      TRACKED_ITEMS,
    pollCount,
    intervalMs: POLL_INTERVAL_MS,
    lastPollAt,
    lastError,
  };
}
