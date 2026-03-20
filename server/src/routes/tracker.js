import { Router } from 'express';
import pool from '../database/db.js';
import { getTrackerStatus } from '../services/tracker.js';

const router = Router();

// Sidebar cache — refreshed hourly by background job in index.js
let sidebarCache = null;
let sidebarCacheExpiry = 0;

export async function refreshSidebarCache() {
  try {
    const [moversRes, untrackedRes] = await Promise.all([
      pool.query(`
        WITH yesterday_avg AS (
          SELECT mat_id, ROUND(AVG(current_price)) AS avg_price
          FROM tracker_snapshots
          WHERE recorded_at >= DATE_TRUNC('day', NOW() - INTERVAL '1 day')
            AND recorded_at <  DATE_TRUNC('day', NOW())
            AND current_price > 0
          GROUP BY mat_id
        ),
        current_price AS (
          SELECT DISTINCT ON (mat_id) mat_id, mat_name, current_price
          FROM tracker_snapshots
          WHERE current_price > 0
          ORDER BY mat_id, recorded_at DESC
        )
        SELECT c.mat_id, c.mat_name, y.avg_price AS open_price, c.current_price AS close_price,
          ROUND(((c.current_price - y.avg_price)::numeric / y.avg_price) * 100, 1) AS pct_change
        FROM current_price c
        JOIN yesterday_avg y ON y.mat_id = c.mat_id
        WHERE y.avg_price <> c.current_price
        ORDER BY ABS((c.current_price - y.avg_price)::numeric / y.avg_price) DESC
        LIMIT 10
      `),
      pool.query(`
        WITH latest_event AS (
          SELECT DISTINCT ON (mat_id) mat_id, mat_name, action, created_at
          FROM tracking_log
          ORDER BY mat_id, created_at DESC
        )
        SELECT le.mat_id, le.mat_name, le.created_at
        FROM latest_event le
        LEFT JOIN tracked_items ti ON ti.mat_id = le.mat_id AND ti.active = TRUE
        WHERE le.action = 'untracked'
          AND ti.mat_id IS NULL
        ORDER BY le.created_at DESC
        LIMIT 8
      `),
    ]);
    sidebarCache = { movers: moversRes.rows, recentlyUntracked: untrackedRes.rows };
    sidebarCacheExpiry = Date.now() + 70 * 60 * 1000; // 70-min safety margin
  } catch (e) {
    console.warn('Sidebar cache refresh failed:', e.message);
  }
}

// GET /api/tracker/status
router.get('/status', (req, res) => {
  res.json(getTrackerStatus());
});

// GET /api/tracker/sidebar
// Top price movers (current vs yesterday avg) + recently untracked items
// Cache is pre-warmed hourly by background job; cold-start fallback computes on demand.
router.get('/sidebar', async (_req, res, next) => {
  try {
    if (!sidebarCache || Date.now() >= sidebarCacheExpiry) {
      await refreshSidebarCache();
    }
    res.json(sidebarCache);
  } catch (err) { next(err); }
});

// GET /api/tracker/snapshots/:matId?limit=120
// Price + supply over time for charting
router.get('/snapshots/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 120, 12000);

    const r = await pool.query(
      `SELECT id, recorded_at, current_price, avg_price, total_qty_available, quick_sell_price
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
       ORDER BY unit_price ASC, order_id ASC`,
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
         s.flash_qty,
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

// GET /api/tracker/company-activity/:matId?hours=24[&date=YYYY-MM-DD]
// Per-company: qty placed vs qty sold vs qty cancelled, plus current listing
router.get('/company-activity/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const hours     = Math.min(Number(req.query.hours) || 24, 720);
    const dateParam = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : null;

    const whereTime     = dateParam
      ? `recorded_at >= $2::date AND recorded_at < $2::date + INTERVAL '1 day'`
      : `recorded_at > NOW() - ($2 || ' hours')::interval`;
    const wherePrevTime = dateParam
      ? `recorded_at >= $2::date - INTERVAL '1 day' AND recorded_at < $2::date`
      : `recorded_at > NOW() - ($3 || ' hours')::interval AND recorded_at <= NOW() - ($2 || ' hours')::interval`;
    const timeParam  = dateParam ?? String(hours);
    const prevParams = dateParam ? [matId, dateParam] : [matId, hours, hours * 2];

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
         AND ${whereTime}
       GROUP BY company_id, company_name`,
      [matId, timeParam]
    );

    // Previous period for share delta (previous day in daily mode, doubled window in rolling mode)
    const prevEvtRes = await pool.query(
      `SELECT
         company_id,
         SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                  THEN ABS(qty_change) ELSE 0 END)::bigint AS qty_sold
       FROM tracker_events
       WHERE mat_id = $1
         AND ${wherePrevTime}
       GROUP BY company_id`,
      prevParams
    );
    const prevQtySoldMap = new Map(prevEvtRes.rows.map((r) => [r.company_id, Number(r.qty_sold)]));

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
        prev_qty_sold:  prevQtySoldMap.get(row.company_id) ?? 0,
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
          prev_qty_sold:  prevQtySoldMap.get(row.company_id) ?? 0,
        });
      }
    }

    const rows = [...merged.values()].sort((a, b) => b.current_listed - a.current_listed);

    res.json({ hours, rows });
  } catch (err) { next(err); }
});

// GET /api/tracker/patterns/:matId
// Average activity per occurrence grouped by hour-of-day and day-of-week
router.get('/patterns/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;

    const [hourRes, dowRes, dayCountRes] = await Promise.all([
      pool.query(
        `WITH day_count AS (
           SELECT COUNT(DISTINCT DATE(recorded_at)) AS n
           FROM tracker_events WHERE mat_id = $1
         )
         SELECT
           EXTRACT(HOUR FROM recorded_at)::int AS bucket,
           ROUND(SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                          THEN ABS(qty_change) ELSE 0 END)::numeric
                 / NULLIF((SELECT n FROM day_count), 0))::bigint AS avg_qty_sold,
           ROUND(SUM(CASE WHEN event_type IN ('new_listing','restocked')
                          THEN qty_change ELSE 0 END)::numeric
                 / NULLIF((SELECT n FROM day_count), 0))::bigint AS avg_qty_listed
         FROM tracker_events
         WHERE mat_id = $1
         GROUP BY bucket ORDER BY bucket`,
        [matId]
      ),
      pool.query(
        `SELECT
           EXTRACT(DOW FROM recorded_at)::int AS bucket,
           ROUND(SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                          THEN ABS(qty_change) ELSE 0 END)::numeric
                 / NULLIF(COUNT(DISTINCT DATE(recorded_at)), 0))::bigint AS avg_qty_sold,
           ROUND(SUM(CASE WHEN event_type IN ('new_listing','restocked')
                          THEN qty_change ELSE 0 END)::numeric
                 / NULLIF(COUNT(DISTINCT DATE(recorded_at)), 0))::bigint AS avg_qty_listed
         FROM tracker_events
         WHERE mat_id = $1
         GROUP BY bucket ORDER BY bucket`,
        [matId]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT DATE(recorded_at)) AS n FROM tracker_events WHERE mat_id = $1`,
        [matId]
      ),
    ]);

    const daysTracked = Number(dayCountRes.rows[0]?.n ?? 0);

    // Fill gaps so charts always show all 24 hours / 7 days
    const hourMap = new Map(hourRes.rows.map((r) => [r.bucket, r]));
    const byHour  = Array.from({ length: 24 }, (_, h) => ({
      label:          `${String(h).padStart(2, '0')}:00`,
      avg_qty_sold:   Number(hourMap.get(h)?.avg_qty_sold   ?? 0),
      avg_qty_listed: Number(hourMap.get(h)?.avg_qty_listed ?? 0),
    }));

    const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowMap = new Map(dowRes.rows.map((r) => [r.bucket, r]));
    const byDow  = Array.from({ length: 7 }, (_, d) => ({
      label:          DOW_LABELS[d],
      avg_qty_sold:   Number(dowMap.get(d)?.avg_qty_sold   ?? 0),
      avg_qty_listed: Number(dowMap.get(d)?.avg_qty_listed ?? 0),
    }));

    res.json({ byHour, byDow, daysTracked });
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
       ORDER BY recorded_at DESC, unit_price ASC`,
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
       ORDER BY recorded_at DESC, unit_price ASC, order_id ASC
       LIMIT $2`,
      [matId, limit]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/tracker/awards/:matId?hours=24
// Top 5 companies by revenue for the given period
router.get('/awards/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const hours = Math.min(Number(req.query.hours) || 24, 720);

    const r = await pool.query(
      `SELECT
         company_id,
         company_name,
         SUM(ABS(qty_change))::bigint              AS qty_sold,
         SUM(ABS(qty_change) * unit_price)::bigint AS revenue,
         ROUND(AVG(unit_price))::int               AS avg_price
       FROM tracker_events
       WHERE mat_id = $1
         AND event_type IN ('partial_fill', 'full_fill')
         AND company_name != 'Federal Reserve'
         AND recorded_at > NOW() - ($2 || ' hours')::interval
       GROUP BY company_id, company_name
       ORDER BY revenue DESC
       LIMIT 5`,
      [matId, hours]
    );

    res.json({ hours, rows: r.rows });
  } catch (err) { next(err); }
});

// GET /api/tracker/pressure/:matId
// Market pressure signal: wall absorption time vs consumption trend
router.get('/pressure/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;

    const snapRes = await pool.query(
      `SELECT id, current_price FROM tracker_snapshots WHERE mat_id=$1 ORDER BY recorded_at DESC LIMIT 1`,
      [matId]
    );
    if (!snapRes.rows.length) return res.json(null);
    const { id: snapId, current_price } = snapRes.rows[0];

    // All price tiers of current order book — wall detection happens in JS after rates are known
    const [wallRes, r6, r1] = await Promise.all([
      pool.query(
        `SELECT unit_price, SUM(qty)::bigint AS tier_qty
         FROM tracker_orders
         WHERE snapshot_id = $1
         GROUP BY unit_price
         ORDER BY unit_price ASC`,
        [snapId]
      ),
      // 6h baseline: avg hourly rate + supply pressure
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN event_type IN ('partial_fill','full_fill') THEN ABS(qty_change) ELSE 0 END), 0)::bigint AS sold,
           COALESCE(SUM(CASE WHEN event_type IN ('new_listing','restocked') THEN qty_change ELSE 0 END), 0)::bigint AS listed
         FROM tracker_events
         WHERE mat_id=$1 AND recorded_at > NOW() - INTERVAL '6 hours'`,
        [matId]
      ),
      // 1h current: sold + listed this hour
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN event_type IN ('partial_fill','full_fill') THEN ABS(qty_change) ELSE 0 END), 0)::bigint AS sold,
           COALESCE(SUM(CASE WHEN event_type IN ('new_listing','restocked') THEN qty_change ELSE 0 END), 0)::bigint AS listed
         FROM tracker_events
         WHERE mat_id=$1 AND recorded_at > NOW() - INTERVAL '1 hour'`,
        [matId]
      ),
    ]);

    const sold_6h   = Number(r6.rows[0].sold);
    const listed_6h = Number(r6.rows[0].listed);
    const sold_1h   = Number(r1.rows[0].sold);
    const listed_1h = Number(r1.rows[0].listed);

    const sales_rate_6h = sold_6h / 6; // avg units sold per hour over last 6h

    // Wall detection: any tier that alone takes >1hr of avg sales to clear.
    // All order book entries are >= current_price so these are resistance levels above.
    const tiers = wallRes.rows.map((r) => ({
      unit_price:   r.unit_price,
      tier_qty:     Number(r.tier_qty),
      hours:        sales_rate_6h > 0 ? +(Number(r.tier_qty) / sales_rate_6h).toFixed(1) : null,
      distance_pct: current_price > 0
        ? +((r.unit_price - current_price) / current_price * 100).toFixed(1)
        : null,
    }));

    const walls      = tiers.filter((t) => t.hours === null || t.hours > 1);
    const first_wall = walls[0] ?? null;
    const at_wall    = first_wall !== null && first_wall.unit_price === current_price;

    // Cluster analysis — walls within CLUSTER_GAP_PCT of each other form a contiguous block.
    // Only walls within RELEVANCE_PCT of current price are considered (distant walls are noise).
    // The SIGNAL is driven by the immediate cluster only, not walls far above.
    const CLUSTER_GAP_PCT = 5;   // walls ≤5% apart are in the same cluster
    const RELEVANCE_PCT   = 15;  // ignore walls beyond 15% above current price

    const nearWalls = walls.filter((w) => w.distance_pct !== null && w.distance_pct <= RELEVANCE_PCT);
    const clusters  = [];
    for (const wall of nearWalls) {
      const last = clusters[clusters.length - 1];
      if (!last) { clusters.push([wall]); continue; }
      const prev    = last[last.length - 1];
      const gapPct  = (wall.unit_price - prev.unit_price) / prev.unit_price * 100;
      gapPct <= CLUSTER_GAP_PCT ? last.push(wall) : clusters.push([wall]);
    }

    const firstCluster      = clusters[0] ?? [];
    const clusterHours      = +firstCluster.reduce((s, w) => s + (w.hours ?? 0), 0).toFixed(1);
    // Gap from end of first cluster to start of second — price "escape room" after breaking through
    const gap_after_pct     = clusters.length > 1
      ? +((clusters[1][0].unit_price - firstCluster[firstCluster.length - 1].unit_price)
          / firstCluster[firstCluster.length - 1].unit_price * 100).toFixed(1)
      : null;

    // D/S ratio: sold / listed — >1 demand outpacing supply, <1 supply flooding
    const ds_ratio_1h  = listed_1h > 0 ? +(sold_1h / listed_1h).toFixed(2) : null;
    const ds_ratio_6h  = listed_6h > 0 ? +(sold_6h / listed_6h).toFixed(2) : null;
    const ds_trend_pct = ds_ratio_6h > 0
      ? +((ds_ratio_1h - ds_ratio_6h) / ds_ratio_6h * 100).toFixed(1)
      : null;

    // Signal: driven by immediate cluster density, not total/distant walls
    // Bearish: dense cluster of walls just above (lots of sequential resistance)
    // Bullish: thin first wall + open space after (price can break through and run)
    // D/S reinforces or overrides
    const bearish_cluster = clusterHours > 15;
    const bearish_ds      = ds_ratio_1h !== null && ds_ratio_1h < 0.5;
    const bullish_thin    = nearWalls.length === 0
                            || (firstCluster[0]?.hours < 5 && (gap_after_pct === null || gap_after_pct > 10));
    const bullish_ds      = ds_ratio_1h !== null && ds_ratio_1h > 0.8
                            && (ds_trend_pct === null || ds_trend_pct > -10);
    let signal = 'neutral';
    if      (bullish_thin && bullish_ds && !bearish_cluster)  signal = 'bullish';
    else if (bearish_cluster || bearish_ds)                   signal = 'bearish';

    res.json({
      current_price,
      walls:      walls.map((w) => ({ unit_price: w.unit_price, hours: w.hours, distance_pct: w.distance_pct })),
      wall_count: walls.length,
      first_wall: first_wall ? { unit_price: first_wall.unit_price, hours: first_wall.hours, distance_pct: first_wall.distance_pct } : null,
      at_wall,
      immediate_cluster: {
        wall_count:    firstCluster.length,
        hours:         clusterHours,
        gap_after_pct,
      },
      sales_rate_6h:  +sales_rate_6h.toFixed(1),
      ds_ratio_1h,
      ds_ratio_6h,
      ds_trend_pct,
      signal,
    });
  } catch (err) { next(err); }
});

// GET /api/tracker/company-events/:matId?company=NAME&hours=24
// All events for a specific company within the time window
router.get('/company-events/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;
    const { company, hours } = req.query;
    if (!company) return res.status(400).json({ error: 'company is required' });
    const h = Math.min(Number(hours) || 24, 720);

    const r = await pool.query(
      `SELECT event_type, ABS(qty_change) AS qty, unit_price, recorded_at
       FROM tracker_events
       WHERE mat_id = $1
         AND company_name = $2
         AND recorded_at > NOW() - ($3 || ' hours')::interval
       ORDER BY recorded_at DESC
       LIMIT 200`,
      [matId, company, h]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/tracker/latest-big-order/:matId
// Most recent new_listing or restocked event with qty > 1hr avg sales (6h baseline).
router.get('/latest-big-order/:matId', async (req, res, next) => {
  try {
    const { matId } = req.params;

    const salesRes = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
               THEN ABS(qty_change) ELSE 0 END), 0)::bigint AS sold
       FROM tracker_events
       WHERE mat_id = $1 AND recorded_at > NOW() - INTERVAL '6 hours'`,
      [matId]
    );
    const hourly_rate = Number(salesRes.rows[0].sold) / 6;
    if (hourly_rate <= 0) return res.json(null);

    const r = await pool.query(
      `SELECT company_name, ABS(qty_change) AS qty, unit_price, recorded_at
       FROM tracker_events
       WHERE mat_id = $1
         AND event_type IN ('new_listing', 'restocked')
         AND company_name != 'Federal Reserve'
         AND ABS(qty_change) > $2
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [matId, Math.floor(hourly_rate)]
    );

    res.json(r.rows[0] ?? null);
  } catch (err) { next(err); }
});

export default router;
