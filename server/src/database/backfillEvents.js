/**
 * Backfill tracker_events from existing tracker_snapshots + tracker_orders.
 *
 * Replays the same diff logic as tracker.js over every consecutive snapshot
 * pair that doesn't already have events recorded. Safe to re-run — it skips
 * any snapshot_b_id that already has entries in tracker_events.
 */

import 'dotenv/config';
import pool from './db.js';

// ── Diff logic (mirrors tracker.js exactly) ────────────────────────────────────

function diffOrderBooks(prevOrders, currOrders, matId, snapshotAId, snapshotBId) {
  const prevMap = new Map(prevOrders.map((o) => [o.order_id, o]));
  const currMap = new Map(currOrders.map((o) => [o.order_id, o]));

  const events = [];

  for (const [orderId, prev] of prevMap) {
    const curr = currMap.get(orderId);
    const cheaperStillExists = currOrders.some((o) => o.unit_price < prev.unit_price);

    if (!curr) {
      events.push({
        matId, orderId,
        companyId:   prev.company_id,
        companyName: prev.company_name,
        unitPrice:   prev.unit_price,
        qtyChange:   -Number(prev.qty),
        eventType:   cheaperStillExists ? 'cancelled' : 'full_fill',
        snapshotAId, snapshotBId,
      });
    } else if (Number(curr.qty) < Number(prev.qty)) {
      events.push({
        matId, orderId,
        companyId:   prev.company_id,
        companyName: prev.company_name,
        unitPrice:   prev.unit_price,
        qtyChange:   -(Number(prev.qty) - Number(curr.qty)),
        eventType:   cheaperStillExists ? 'cancelled' : 'partial_fill',
        snapshotAId, snapshotBId,
      });
    } else if (Number(curr.qty) > Number(prev.qty)) {
      events.push({
        matId, orderId,
        companyId:   prev.company_id,
        companyName: prev.company_name,
        unitPrice:   prev.unit_price,
        qtyChange:   Number(curr.qty) - Number(prev.qty),
        eventType:   'restocked',
        snapshotAId, snapshotBId,
      });
    }
  }

  for (const [orderId, curr] of currMap) {
    if (!prevMap.has(orderId)) {
      events.push({
        matId, orderId,
        companyId:   curr.company_id,
        companyName: curr.company_name,
        unitPrice:   curr.unit_price,
        qtyChange:   Number(curr.qty),
        eventType:   'new_listing',
        snapshotAId, snapshotBId,
      });
    }
  }

  return events;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function backfill() {
  // Find snapshot_b_ids that already have events so we can skip them
  const existingRes = await pool.query(
    `SELECT DISTINCT snapshot_b_id FROM tracker_events`
  );
  const alreadyDone = new Set(existingRes.rows.map((r) => r.snapshot_b_id));

  // Get all distinct material IDs
  const mats = await pool.query(
    `SELECT DISTINCT mat_id, mat_name FROM tracker_snapshots ORDER BY mat_id`
  );

  let totalEvents = 0;
  let totalPairs  = 0;
  let skipped     = 0;

  for (const { mat_id, mat_name } of mats.rows) {
    // Get all snapshots for this material in time order
    const snapsRes = await pool.query(
      `SELECT id, recorded_at FROM tracker_snapshots
       WHERE mat_id = $1 ORDER BY recorded_at ASC`,
      [mat_id]
    );
    const snaps = snapsRes.rows;

    console.log(`\n${mat_name}: ${snaps.length} snapshots`);

    for (let i = 0; i < snaps.length - 1; i++) {
      const snapA = snaps[i];
      const snapB = snaps[i + 1];

      if (alreadyDone.has(snapB.id)) {
        skipped++;
        continue;
      }

      // Load orders for both snapshots
      const [ordersA, ordersB] = await Promise.all([
        pool.query(`SELECT order_id, company_id, company_name, unit_price, qty FROM tracker_orders WHERE snapshot_id=$1`, [snapA.id]),
        pool.query(`SELECT order_id, company_id, company_name, unit_price, qty FROM tracker_orders WHERE snapshot_id=$1`, [snapB.id]),
      ]);

      const events = diffOrderBooks(ordersA.rows, ordersB.rows, mat_id, snapA.id, snapB.id);

      if (events.length > 0) {
        // Use the B snapshot's recorded_at as the event timestamp
        const recordedAt = snapB.recorded_at;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const e of events) {
            await client.query(
              `INSERT INTO tracker_events(mat_id, order_id, company_id, company_name, unit_price, qty_change, event_type, recorded_at, snapshot_a_id, snapshot_b_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [e.matId, e.orderId, e.companyId, e.companyName, e.unitPrice, e.qtyChange, e.eventType, recordedAt, e.snapshotAId, e.snapshotBId]
            );
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }

        const sells  = events.filter((e) => e.eventType === 'partial_fill' || e.eventType === 'full_fill');
        const listed = events.filter((e) => e.eventType === 'new_listing' || e.eventType === 'restocked');
        process.stdout.write(`  pair ${snapA.id}→${snapB.id}: ${events.length} events (${sells.length} fills, ${listed.length} listings)\n`);
        totalEvents += events.length;
      }

      totalPairs++;
    }
  }

  console.log(`\nDone. Processed ${totalPairs} pairs, inserted ${totalEvents} events (${skipped} already had events).`);
}

backfill()
  .catch((err) => { console.error('Backfill failed:', err); process.exit(1); })
  .finally(() => pool.end());
