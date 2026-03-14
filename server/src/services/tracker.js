/**
 * Market Tracker Service
 *
 * Polls mat-details every 60 seconds for all actively tracked items.
 * Items and their owner API keys are loaded from the DB each cycle so new
 * registrations are picked up without a server restart.
 *
 * Each item is polled using its owner's API key (their own 500-unit budget).
 * Items with no owner (unclaimed) are skipped until a user claims them.
 *
 * Rate budget: 5 units per item per poll.
 * Revoke detection: 401/403 from GT API marks the owner as revoked.
 * Retention: tracker_orders pruned to the 2 most recent snapshots per item (hourly via index.js).
 */

import pool from '../database/db.js';
import { gtFetch } from './gtApi.js';
import { decryptApiKey, hashApiKey } from '../utils/apiKeyCrypto.js';

// ── Game price increment lookup ────────────────────────────────────────────────
function gameIncrement(priceCents) {
  if (priceCents <    5_000) return       50;
  if (priceCents <   10_000) return      100;
  if (priceCents <   50_000) return      500;
  if (priceCents <  100_000) return    1_000;
  if (priceCents <  500_000) return    5_000;
  if (priceCents < 1_000_000) return  10_000;
  if (priceCents < 5_000_000) return  50_000;
  return 100_000;
}

const POLL_INTERVAL_MS = 60_000;
const UNITS_PER_ITEM   = 5;

let intervalHandle = null;
let lastError      = null;
let pollCount      = 0;
let lastPollAt     = null;
const recentErrors = []; // rolling last-50 errors for admin panel

// ── Load tracked items from DB ─────────────────────────────────────────────────

async function loadTrackedItems() {
  const r = await pool.query(
    `SELECT ti.mat_id          AS "matId",
            ti.mat_name        AS "matName",
            u.api_key_encrypted AS "apiKeyEnc"
     FROM tracked_items ti
     LEFT JOIN users u ON u.id = ti.owner_user_id AND u.revoked = FALSE
     WHERE ti.active = TRUE`
  );
  return r.rows.map((row) => ({
    ...row,
    apiKey: row.apiKeyEnc ? decryptApiKey(row.apiKeyEnc) : null,
  }));
}

// ── API fetch ──────────────────────────────────────────────────────────────────

function fetchMatDetails(matId, apiKey) {
  return gtFetch(`/public/exchange/mat-details/${matId}`, UNITS_PER_ITEM, apiKey);
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

  if (orders.length > 0) {
    const vals   = orders.map((_, i) => `($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`);
    const params = orders.flatMap((o) => [snapId, o.id, o.cId, o.cName, o.unitPrice, o.qty]);
    await client.query(
      `INSERT INTO tracker_orders(snapshot_id,order_id,company_id,company_name,unit_price,qty) VALUES ${vals.join(',')}`,
      params
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

function diffOrderBooks(prevOrders, currOrders, matId, snapshotAId, snapshotBId) {
  const prevMap = new Map(prevOrders.map((o) => [o.orderId, o]));
  const currMap = new Map(currOrders.map((o) => [o.orderId, o]));
  const events  = [];

  for (const [orderId, prev] of prevMap) {
    const curr = currMap.get(orderId);
    const cheaperStillExists = currOrders.some((o) => o.unitPrice < prev.unitPrice);

    if (!curr) {
      events.push({ matId, orderId, companyId: prev.companyId, companyName: prev.companyName, unitPrice: prev.unitPrice, qtyChange: -prev.qty, eventType: cheaperStillExists ? 'cancelled' : 'full_fill', snapshotAId, snapshotBId });
    } else if (curr.qty < prev.qty) {
      events.push({ matId, orderId, companyId: prev.companyId, companyName: prev.companyName, unitPrice: prev.unitPrice, qtyChange: -(prev.qty - curr.qty), eventType: 'partial_fill', snapshotAId, snapshotBId });
    } else if (curr.qty > prev.qty) {
      events.push({ matId, orderId, companyId: prev.companyId, companyName: prev.companyName, unitPrice: prev.unitPrice, qtyChange: curr.qty - prev.qty, eventType: 'restocked', snapshotAId, snapshotBId });
    }
  }

  for (const [orderId, curr] of currMap) {
    if (!prevMap.has(orderId)) {
      events.push({ matId, orderId, companyId: curr.companyId, companyName: curr.companyName, unitPrice: curr.unitPrice, qtyChange: curr.qty, eventType: 'new_listing', snapshotAId, snapshotBId });
    }
  }

  return events;
}

// ── Poll one item ──────────────────────────────────────────────────────────────

async function pollItem(item) {
  const data = await fetchMatDetails(item.matId, item.apiKey);

  const todayStr     = new Date().toISOString().slice(0, 10);
  const priceHistory = data.priceHistory ?? [];
  const todayHistory = priceHistory.find((h) => h.date === todayStr) ?? priceHistory[0] ?? null;
  const apiQtySold     = todayHistory?.qtySold ?? null;
  const apiQtySoldDate = todayHistory?.date    ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prevSnap = await getLastSnapshot(item.matId);
    const snapId   = await saveSnapshot(client, data, apiQtySold, apiQtySoldDate);

    let attributedSold = 0;
    let qtyListed      = 0;
    let qtyCancelled   = 0;

    if (prevSnap && prevSnap.orders) {
      const prevOrders = prevSnap.orders.map((o) => ({
        orderId: o.orderId, companyId: o.companyId, companyName: o.companyName,
        unitPrice: o.unitPrice, qty: Number(o.qty),
      }));
      const currOrders = (data.orders ?? []).map((o) => ({
        orderId: o.id, companyId: o.cId, companyName: o.cName, unitPrice: o.unitPrice, qty: o.qty,
      }));

      const events = diffOrderBooks(prevOrders, currOrders, item.matId, prevSnap.id, snapId);

      if (events.length > 0) {
        await saveEvents(client, events);

        const sales     = events.filter((e) => e.eventType === 'partial_fill' || e.eventType === 'full_fill');
        const newList   = events.filter((e) => e.eventType === 'new_listing');
        const cancelled = events.filter((e) => e.eventType === 'cancelled');
        const restocked = events.filter((e) => e.eventType === 'restocked');

        attributedSold = sales.reduce((s, e) => s + Math.abs(e.qtyChange), 0);
        qtyListed      = newList.reduce((s, e) => s + e.qtyChange, 0) + restocked.reduce((s, e) => s + e.qtyChange, 0);
        qtyCancelled   = cancelled.reduce((s, e) => s + Math.abs(e.qtyChange), 0);

        const parts = [];
        if (attributedSold) parts.push(`${attributedSold.toLocaleString()} sold`);
        if (qtyListed)      parts.push(`${qtyListed.toLocaleString()} listed`);
        if (qtyCancelled)   parts.push(`${qtyCancelled.toLocaleString()} cancelled`);
        if (parts.length)   console.log(`[tracker] ${item.matName}: ${parts.join(', ')}`);
      }
    }

    // ── Flash sale reconciliation ─────────────────────────────────────────────
    if (
      prevSnap &&
      prevSnap.api_qty_sold      !== null &&
      apiQtySold                 !== null &&
      prevSnap.api_qty_sold_date === apiQtySoldDate
    ) {
      const windowMs = Date.now() - new Date(prevSnap.recorded_at).getTime();
      if (windowMs <= 150_000) {
        const deltaSold = apiQtySold - Number(prevSnap.api_qty_sold);
        const flash     = Math.max(0, deltaSold - attributedSold);
        if (flash > 0) {
          await client.query(`UPDATE tracker_snapshots SET flash_qty = $1 WHERE id = $2`, [flash, snapId]);
          console.log(`[tracker] ${item.matName}: ${flash.toLocaleString()} flash sales`);
        }
      }
    }

    // ── Quick sell price ──────────────────────────────────────────────────────
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
        await client.query(`UPDATE tracker_snapshots SET quick_sell_price = $1 WHERE id = $2`, [quick_sell_price, snapId]);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Check price alerts outside the transaction (fire-and-forget)
  checkPriceAlerts(item.matId, data.currentPrice).catch((e) =>
    console.error('[tracker] price alert check failed:', e.message)
  );
}

async function checkPriceAlerts(matId, currentPrice) {
  if (!currentPrice || currentPrice <= 0) return;

  const alerts = await pool.query(
    `SELECT id, user_id, mat_name, target_price, direction FROM price_alerts WHERE mat_id = $1`,
    [matId]
  );

  for (const alert of alerts.rows) {
    const triggered =
      (alert.direction === 'up'   && currentPrice >= alert.target_price) ||
      (alert.direction === 'down' && currentPrice <= alert.target_price);

    if (triggered) {
      const displayPrice = `$${(alert.target_price / 100).toFixed(2)}`;
      await pool.query(
        `INSERT INTO notifications(user_id, type, mat_name, from_company)
         VALUES($1, 'price_alert', $2, $3)`,
        [alert.user_id, alert.mat_name, displayPrice]
      ).catch((e) => console.error('[tracker] price alert notification insert failed:', e.message));
      await pool.query(
        `DELETE FROM price_alerts WHERE id = $1`,
        [alert.id]
      ).catch((e) => console.error('[tracker] price alert delete failed:', e.message));
      console.log(`[tracker] price alert triggered: ${alert.mat_name} @ ${displayPrice} for user ${alert.user_id}`);
    }
  }
}


// ── Poll cycle ─────────────────────────────────────────────────────────────────

async function pollAll() {
  lastPollAt = new Date().toISOString();
  pollCount++;

  const items = await loadTrackedItems();

  for (const item of items) {
    if (!item.apiKey) {
      // Unclaimed item — no key to poll with
      continue;
    }
    try {
      await pollItem(item);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // Key revoked in-game — mark user as revoked and disable their tracked items
        try {
          const revoked = await pool.query(
            `UPDATE users SET revoked = TRUE WHERE api_key = $1 RETURNING id, company_name`,
            [hashApiKey(item.apiKey)]
          );
          if (revoked.rows.length > 0) {
            const { id: userId, company_name: companyName } = revoked.rows[0];
            const items = await pool.query(
              `UPDATE tracked_items SET active = FALSE
               WHERE owner_user_id = $1 AND active = TRUE
               RETURNING mat_id, mat_name`,
              [userId]
            );
            if (items.rows.length > 0) {
              await pool.query(
                `UPDATE users SET credits_used = GREATEST(0, credits_used - $1) WHERE id = $2`,
                [items.rows.length, userId]
              );
              for (const { mat_id, mat_name } of items.rows) {
                await pool.query(
                  `INSERT INTO tracking_log(mat_id, mat_name, user_id, company_name, action, by_admin)
                   VALUES($1, $2, $3, $4, 'untracked', FALSE)`,
                  [mat_id, mat_name, userId, companyName]
                ).catch(e => console.error('[tracker] tracking_log insert failed:', e.message));
                pool.query(
                  `INSERT INTO notifications(user_id, type, mat_name, from_company)
                   SELECT id, 'untracked', $1, $2 FROM users WHERE role = 'admin'`,
                  [mat_name, companyName]
                ).catch(e => console.error('[tracker] notification insert failed:', e.message));
              }
            }
          }
          console.warn(`[tracker] API key revoked for ${item.matName} owner — stopping their polls`);
        } catch { /* ignore */ }
      } else if (err.rateLimited) {
        console.warn(`[tracker] rate limited — skipping ${item.matName} this cycle`);
      } else {
        lastError = { item: item.matName, message: err.message, at: new Date().toISOString() };
        recentErrors.unshift(lastError);
        if (recentErrors.length > 50) recentErrors.pop();
        console.error(`[tracker] error for ${item.matName}:`, err.message);
      }
    }
  }

}

// ── Public API ─────────────────────────────────────────────────────────────────

export function startTracker() {
  loadTrackedItems().then((items) => {
    const names = items.map((i) => i.matName).join(', ') || '(none — awaiting user registration)';
    console.log(`[tracker] starting — polling: ${names} every ${POLL_INTERVAL_MS / 1000}s`);
  });
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
    pollCount,
    intervalMs: POLL_INTERVAL_MS,
    lastPollAt,
    lastError,
  };
}

export function getRecentErrors() {
  return recentErrors;
}
