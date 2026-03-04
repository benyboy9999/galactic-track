import { Router } from 'express';
import pool from '../database/db.js';
import { getTrackerStatus } from '../services/tracker.js';

const router = Router();

// GET /api/tracker/status
router.get('/status', (req, res) => {
  res.json(getTrackerStatus());
});

// GET /api/tracker/snapshots/:matId?limit=120
// Price + supply over time for charting
router.get('/snapshots/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 120, 1440);

    const r = await pool.query(
      `SELECT id, recorded_at, current_price, avg_price, total_qty_available
       FROM tracker_snapshots
       WHERE mat_id = $1
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [matId, limit]
    );
    res.json(r.rows.reverse());
  } catch (err) { next(err); }
});

// GET /api/tracker/orders/:matId
// Current order book with delta vs previous snapshot
router.get('/orders/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;

    // Get two most recent snapshots
    const snapRes = await pool.query(
      `SELECT id, recorded_at, current_price, total_qty_available
       FROM tracker_snapshots
       WHERE mat_id = $1
       ORDER BY recorded_at DESC
       LIMIT 2`,
      [matId]
    );

    if (!snapRes.rows.length) return res.json({ snapshot: null, orders: [] });

    const [curr, prev] = snapRes.rows; // newest first

    // Fetch orders for current snapshot
    const currOrders = await pool.query(
      `SELECT order_id, company_id, company_name, unit_price, qty
       FROM tracker_orders
       WHERE snapshot_id = $1
       ORDER BY unit_price ASC, qty DESC`,
      [curr.id]
    );

    // Fetch orders for previous snapshot (if exists) as a lookup map
    let prevMap = new Map();
    if (prev) {
      const prevOrders = await pool.query(
        `SELECT order_id, qty FROM tracker_orders WHERE snapshot_id = $1`,
        [prev.id]
      );
      prevMap = new Map(prevOrders.rows.map((o) => [o.order_id, Number(o.qty)]));
    }

    const orders = currOrders.rows.map((o) => {
      const prevQty = prevMap.get(o.order_id) ?? null;
      const qtyChange = prevQty !== null ? Number(o.qty) - prevQty : null;
      return {
        ...o,
        qty: Number(o.qty),
        prev_qty: prevQty,
        qty_change: qtyChange,
        is_new: prevQty === null && prev !== undefined,
      };
    });

    res.json({ snapshot: curr, prev_snapshot: prev ?? null, orders });
  } catch (err) { next(err); }
});

// GET /api/tracker/activity/:matId?hours=24
// Per-snapshot sales activity for the bar chart
router.get('/activity/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const hours = Math.min(Number(req.query.hours) || 24, 720);

    const r = await pool.query(
      `SELECT
         s.id          AS snapshot_id,
         s.recorded_at,
         s.current_price,
         s.total_qty_available,
         COALESCE(SUM(CASE WHEN e.event_type IN ('partial_fill','full_fill')
                           THEN ABS(e.qty_change) END), 0)::bigint AS qty_sold_since_prev,
         COALESCE(SUM(CASE WHEN e.event_type IN ('new_listing','restocked')
                           THEN e.qty_change END), 0)::bigint      AS qty_listed_since_prev
       FROM tracker_snapshots s
       LEFT JOIN tracker_events e
         ON e.snapshot_b_id = s.id AND e.mat_id = s.mat_id
       WHERE s.mat_id = $1
         AND s.recorded_at > NOW() - ($2 || ' hours')::interval
       GROUP BY s.id
       ORDER BY s.recorded_at ASC`,
      [matId, hours]
    );

    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/tracker/marketshare/:matId?hours=24
// Company market share — sales only (partial_fill + full_fill)
router.get('/marketshare/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const hours = Math.min(Number(req.query.hours) || 24, 720);

    const r = await pool.query(
      `SELECT
         company_id,
         company_name,
         SUM(ABS(qty_change))::bigint              AS qty_sold,
         SUM(ABS(qty_change) * unit_price)::bigint AS revenue,
         COUNT(*) FILTER (WHERE event_type='full_fill')::int    AS full_fills,
         COUNT(*) FILTER (WHERE event_type='partial_fill')::int AS partial_fills,
         MIN(unit_price) AS min_price,
         MAX(unit_price) AS max_price,
         ROUND(AVG(unit_price))::int AS avg_price
       FROM tracker_events
       WHERE mat_id = $1
         AND event_type IN ('partial_fill', 'full_fill')
         AND recorded_at > NOW() - ($2 || ' hours')::interval
       GROUP BY company_id, company_name
       ORDER BY qty_sold DESC`,
      [matId, hours]
    );

    const totalQty = r.rows.reduce((s, row) => s + Number(row.qty_sold), 0);
    const rows = r.rows.map((row) => ({
      ...row,
      sharePct: totalQty > 0 ? +((Number(row.qty_sold) / totalQty) * 100).toFixed(1) : 0,
    }));

    res.json({ totalQty, hours, rows });
  } catch (err) { next(err); }
});

// GET /api/tracker/company-activity/:matId?hours=24
// Per-company: qty placed vs qty sold vs qty cancelled, plus current listing
router.get('/company-activity/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const hours = Math.min(Number(req.query.hours) || 24, 720);

    // Event aggregates
    const evtRes = await pool.query(
      `SELECT
         company_id,
         company_name,
         SUM(CASE WHEN event_type IN ('new_listing','restocked')
                  THEN qty_change ELSE 0 END)::bigint                        AS qty_placed,
         SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                  THEN ABS(qty_change) ELSE 0 END)::bigint                   AS qty_sold,
         SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                  THEN ABS(qty_change) * unit_price ELSE 0 END)::bigint      AS revenue,
         SUM(CASE WHEN event_type = 'cancelled'
                  THEN ABS(qty_change) ELSE 0 END)::bigint                   AS qty_cancelled
       FROM tracker_events
       WHERE mat_id = $1
         AND recorded_at > NOW() - ($2 || ' hours')::interval
       GROUP BY company_id, company_name`,
      [matId, hours]
    );

    // Current listings from latest snapshot
    const listRes = await pool.query(
      `SELECT o.company_id, o.company_name, SUM(o.qty)::bigint AS current_listed
       FROM tracker_orders o
       JOIN tracker_snapshots s ON s.id = o.snapshot_id
       WHERE s.mat_id = $1
         AND s.id = (
           SELECT id FROM tracker_snapshots WHERE mat_id=$1 ORDER BY recorded_at DESC LIMIT 1
         )
       GROUP BY o.company_id, o.company_name`,
      [matId]
    );

    const listMap = new Map(listRes.rows.map((r) => [r.company_id, Number(r.current_listed)]));

    // Merge: include companies that appear in events OR current order book
    const merged = new Map();

    for (const row of evtRes.rows) {
      merged.set(row.company_id, {
        company_id:     row.company_id,
        company_name:   row.company_name,
        qty_placed:     Number(row.qty_placed),
        qty_sold:       Number(row.qty_sold),
        revenue:        Number(row.revenue),
        qty_cancelled:  Number(row.qty_cancelled),
        current_listed: listMap.get(row.company_id) ?? 0,
      });
    }

    for (const row of listRes.rows) {
      if (!merged.has(row.company_id)) {
        merged.set(row.company_id, {
          company_id:     row.company_id,
          company_name:   row.company_name,
          qty_placed:     0,
          qty_sold:       0,
          revenue:        0,
          qty_cancelled:  0,
          current_listed: Number(row.current_listed),
        });
      }
    }

    const rows = [...merged.values()].sort((a, b) => b.current_listed - a.current_listed);

    res.json({ hours, rows });
  } catch (err) { next(err); }
});

// GET /api/tracker/patterns/:matId
// Cumulative activity grouped by hour-of-day and day-of-week (all history)
router.get('/patterns/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;

    const [hourRes, dowRes] = await Promise.all([
      pool.query(
        `SELECT
           EXTRACT(HOUR FROM recorded_at)::int AS bucket,
           SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                    THEN ABS(qty_change) ELSE 0 END)::bigint AS qty_sold,
           SUM(CASE WHEN event_type IN ('new_listing','restocked')
                    THEN qty_change ELSE 0 END)::bigint      AS qty_listed
         FROM tracker_events
         WHERE mat_id = $1
         GROUP BY bucket ORDER BY bucket`,
        [matId]
      ),
      pool.query(
        `SELECT
           EXTRACT(DOW FROM recorded_at)::int AS bucket,
           SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                    THEN ABS(qty_change) ELSE 0 END)::bigint AS qty_sold,
           SUM(CASE WHEN event_type IN ('new_listing','restocked')
                    THEN qty_change ELSE 0 END)::bigint      AS qty_listed
         FROM tracker_events
         WHERE mat_id = $1
         GROUP BY bucket ORDER BY bucket`,
        [matId]
      ),
    ]);

    // Fill gaps so charts always show all 24 hours / 7 days
    const hourMap = new Map(hourRes.rows.map((r) => [r.bucket, r]));
    const byHour  = Array.from({ length: 24 }, (_, h) => ({
      label:      `${String(h).padStart(2, '0')}:00`,
      qty_sold:   Number(hourMap.get(h)?.qty_sold   ?? 0),
      qty_listed: Number(hourMap.get(h)?.qty_listed ?? 0),
    }));

    const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowMap = new Map(dowRes.rows.map((r) => [r.bucket, r]));
    const byDow  = Array.from({ length: 7 }, (_, d) => ({
      label:      DOW_LABELS[d],
      qty_sold:   Number(dowMap.get(d)?.qty_sold   ?? 0),
      qty_listed: Number(dowMap.get(d)?.qty_listed ?? 0),
    }));

    res.json({ byHour, byDow });
  } catch (err) { next(err); }
});

// GET /api/tracker/events/:matId?from=ISO&to=ISO
// All events within a time window (for bar-click drill-down)
router.get('/events/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

    const r = await pool.query(
      `SELECT company_name, event_type, ABS(qty_change) AS qty, unit_price, recorded_at
       FROM tracker_events
       WHERE mat_id = $1
         AND company_name != 'Federal Reserve'
         AND recorded_at >= $2
         AND recorded_at < $3
       ORDER BY recorded_at ASC, unit_price ASC`,
      [matId, from, to]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/tracker/recent/:matId?limit=10
// Most recent individual events for the activity feed
router.get('/recent/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    const r = await pool.query(
      `SELECT company_name, event_type, ABS(qty_change) AS qty, unit_price, recorded_at
       FROM tracker_events
       WHERE mat_id = $1
         AND company_name != 'Federal Reserve'
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [matId, limit]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

export default router;
