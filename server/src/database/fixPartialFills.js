/**
 * Fix historical events where partial qty decreases were wrongly classified
 * as 'cancelled'. The game only allows full-listing cancellations, so any
 * event where the order still exists in snapshot B (qty decreased but not
 * gone) must be a sale (partial_fill), not a cancellation.
 *
 * Safe to re-run — the WHERE clause means it's a no-op if already applied.
 */

import 'dotenv/config';
import pool from './db.js';

const { rows } = await pool.query(`
  UPDATE tracker_events e
  SET event_type = 'partial_fill'
  WHERE e.event_type = 'cancelled'
    AND EXISTS (
      SELECT 1 FROM tracker_orders o
      WHERE o.snapshot_id = e.snapshot_b_id
        AND o.order_id = e.order_id
    )
  RETURNING e.id
`);

console.log(`Updated ${rows.length} events: cancelled → partial_fill`);
await pool.end();
