import { Router } from 'express';
import pool from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/company/search?q=
// Returns distinct companies seen in tracker_events matching the query.
router.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q ?? '').trim();
    const r = await pool.query(
      `SELECT DISTINCT ON (company_id) company_id, company_name
       FROM tracker_events
       WHERE company_name ILIKE $1 AND company_id IS NOT NULL
       ORDER BY company_id, company_name ASC
       LIMIT 15`,
      [`%${q}%`]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/company/timeline?companyId=&hours=24
// Time-bucketed sold/listed counts for the bar chart.
router.get('/timeline', requireAuth, async (req, res, next) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 24, 720);
    const isDevOrAdmin = req.user.role === 'admin' || req.user.company_id === '0';
    const companyId = isDevOrAdmin && req.query.companyId
      ? parseInt(req.query.companyId, 10)
      : parseInt(req.user.company_id, 10);

    if (!companyId) return res.json([]);

    // Client may override bucket size (e.g. chart resolution picker)
    const bucketSecs = req.query.bucketSecs
      ? Math.max(60, Math.min(Number(req.query.bucketSecs), 86400))
      : hours <= 6   ?    900   // 15 min
      : hours <= 24  ?   3600   // 1 hour
      : hours <= 168 ?  14400   // 4 hours
      :                 86400;  // 1 day

    // Optional specific calendar day (YYYY-MM-DD); overrides rolling window
    const dateParam = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : null;
    const whereTime = dateParam
      ? `te.recorded_at >= $2::date AND te.recorded_at < $2::date + INTERVAL '1 day'`
      : `te.recorded_at > NOW() - ($2 || ' hours')::interval`;
    const queryParams = dateParam
      ? [companyId, dateParam, bucketSecs]
      : [companyId, hours, bucketSecs];

    const r = await pool.query(
      `SELECT
         to_timestamp(floor(extract(epoch from recorded_at) / $3) * $3) AS bucket,
         SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                  THEN ABS(qty_change) ELSE 0 END)::bigint               AS qty_sold,
         SUM(CASE WHEN event_type IN ('new_listing','restocked')
                  THEN qty_change     ELSE 0 END)::bigint                 AS qty_listed
       FROM tracker_events te
       JOIN tracked_items ti ON ti.mat_id = te.mat_id AND ti.active = TRUE
       WHERE te.company_id = $1
         AND ${whereTime}
       GROUP BY bucket
       ORDER BY bucket ASC`,
      queryParams
    );

    res.json(r.rows.map((row) => ({
      recorded_at: row.bucket,
      qty_sold:    Number(row.qty_sold),
      qty_listed:  Number(row.qty_listed),
    })));
  } catch (err) { next(err); }
});

// GET /api/company/events?companyId=&limit=20
// Returns recent tracker_events for a company across all tracked items.
router.get('/events', requireAuth, async (req, res, next) => {
  try {
    const isDevOrAdmin = req.user.role === 'admin' || req.user.company_id === '0';
    const companyId = isDevOrAdmin && req.query.companyId
      ? parseInt(req.query.companyId, 10)
      : parseInt(req.user.company_id, 10);

    if (!companyId) return res.json([]);

    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const from  = req.query.from ? new Date(req.query.from) : null;
    const to    = req.query.to   ? new Date(req.query.to)   : null;

    const params = [companyId, limit];
    const whereClauses = ['te.company_id = $1'];
    if (from) { params.push(from); whereClauses.push(`te.recorded_at >= $${params.length}`); }
    if (to)   { params.push(to);   whereClauses.push(`te.recorded_at <  $${params.length}`); }

    const r = await pool.query(
      `SELECT te.event_type, te.qty_change, te.unit_price, te.recorded_at,
              ti.mat_name
       FROM tracker_events te
       JOIN tracked_items ti ON ti.mat_id = te.mat_id AND ti.active = TRUE
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY te.recorded_at ${from ? 'ASC' : 'DESC'}
       LIMIT $2`,
      params
    );

    res.json(r.rows.map((row) => ({
      eventType:  row.event_type,
      qtyChange:  Number(row.qty_change),
      unitPrice:  Number(row.unit_price),
      recordedAt: row.recorded_at,
      matName:    row.mat_name,
    })));
  } catch (err) { next(err); }
});

// GET /api/company/summary?hours=24&companyId=[&date=YYYY-MM-DD]
// Returns company activity with rank, marketshare, growth per tracked item.
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const hours     = Math.min(Number(req.query.hours) || 24, 720);
    const dateParam = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : null;

    const isDevOrAdmin = req.user.role === 'admin' || req.user.company_id === '0';
    const companyId = isDevOrAdmin && req.query.companyId
      ? parseInt(req.query.companyId, 10)
      : parseInt(req.user.company_id, 10);

    if (!companyId) {
      return res.json({
        companyId:   req.user.company_id,
        companyName: req.user.company_name,
        companyLogo: req.user.company_logo ?? null,
        companyTag:  req.user.company_tag  ?? '',
        hours,
        items:  [],
        totals: { qtyPlaced: 0, qtySold: 0, revenue: 0, qtyCancelled: 0, currentListed: 0, activeItems: 0, avgRank: null, avgMarketshare: 0 },
      });
    }

    // ── CTE: company stats + market stats + ranks ───────────────────────────
    // Two variants: rolling (hours-based) or daily (date-based)
    let evtSql, evtParams;
    if (dateParam) {
      evtSql = `
        WITH this_co AS (
          SELECT
            te.mat_id,
            MIN(ti.mat_name)                                                          AS mat_name,
            SUM(CASE WHEN event_type IN ('new_listing','restocked')
                     THEN qty_change    ELSE 0 END)::bigint                           AS qty_placed,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                     THEN ABS(qty_change) ELSE 0 END)::bigint                         AS qty_sold,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                     THEN ABS(qty_change) * unit_price ELSE 0 END)::bigint            AS revenue,
            SUM(CASE WHEN event_type = 'cancelled'
                     THEN ABS(qty_change) ELSE 0 END)::bigint                         AS qty_cancelled
          FROM tracker_events te
          JOIN tracked_items ti ON ti.mat_id = te.mat_id AND ti.active = TRUE
          WHERE te.company_id = $1
            AND te.recorded_at >= $2::date AND te.recorded_at < $2::date + INTERVAL '1 day'
          GROUP BY te.mat_id
        ),
        prev_co AS (
          SELECT
            te.mat_id,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                     THEN ABS(qty_change) ELSE 0 END)::bigint AS prev_qty_sold
          FROM tracker_events te
          JOIN tracked_items ti ON ti.mat_id = te.mat_id AND ti.active = TRUE
          WHERE te.company_id = $1
            AND te.recorded_at >= $2::date - INTERVAL '1 day' AND te.recorded_at < $2::date
          GROUP BY te.mat_id
        ),
        all_sales AS (
          SELECT
            te.mat_id,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                          AND te.recorded_at >= $2::date AND te.recorded_at < $2::date + INTERVAL '1 day'
                     THEN ABS(qty_change) ELSE 0 END)::bigint AS total_sold,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                          AND te.recorded_at >= $2::date - INTERVAL '1 day' AND te.recorded_at < $2::date
                     THEN ABS(qty_change) ELSE 0 END)::bigint AS prev_total_sold
          FROM tracker_events te
          WHERE te.mat_id IN (SELECT mat_id FROM this_co)
            AND te.recorded_at >= $2::date - INTERVAL '1 day' AND te.recorded_at < $2::date + INTERVAL '1 day'
          GROUP BY te.mat_id
        ),
        company_ranks AS (
          SELECT
            te.mat_id,
            te.company_id,
            RANK() OVER (
              PARTITION BY te.mat_id
              ORDER BY SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                                THEN ABS(qty_change) ELSE 0 END) DESC
            ) AS rank
          FROM tracker_events te
          WHERE te.mat_id IN (SELECT mat_id FROM this_co)
            AND te.recorded_at >= $2::date AND te.recorded_at < $2::date + INTERVAL '1 day'
          GROUP BY te.mat_id, te.company_id
        )
        SELECT
          tc.mat_id, tc.mat_name, tc.qty_placed, tc.qty_sold, tc.revenue, tc.qty_cancelled,
          COALESCE(pc.prev_qty_sold, 0)   AS prev_qty_sold,
          COALESCE(als.total_sold, 1)     AS total_sold,
          COALESCE(als.prev_total_sold,0) AS prev_total_sold,
          COALESCE(cr.rank, 0)            AS rank
        FROM this_co tc
        LEFT JOIN prev_co pc        ON pc.mat_id  = tc.mat_id
        LEFT JOIN all_sales als     ON als.mat_id = tc.mat_id
        LEFT JOIN company_ranks cr  ON cr.mat_id  = tc.mat_id AND cr.company_id = $1
        ORDER BY tc.qty_sold DESC`;
      evtParams = [companyId, dateParam];
    } else {
      evtSql = `
        WITH this_co AS (
          SELECT
            te.mat_id,
            MIN(ti.mat_name)                                                          AS mat_name,
            SUM(CASE WHEN event_type IN ('new_listing','restocked')
                     THEN qty_change    ELSE 0 END)::bigint                           AS qty_placed,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                     THEN ABS(qty_change) ELSE 0 END)::bigint                         AS qty_sold,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                     THEN ABS(qty_change) * unit_price ELSE 0 END)::bigint            AS revenue,
            SUM(CASE WHEN event_type = 'cancelled'
                     THEN ABS(qty_change) ELSE 0 END)::bigint                         AS qty_cancelled
          FROM tracker_events te
          JOIN tracked_items ti ON ti.mat_id = te.mat_id AND ti.active = TRUE
          WHERE te.company_id = $1
            AND te.recorded_at > NOW() - ($2 || ' hours')::interval
          GROUP BY te.mat_id
        ),
        prev_co AS (
          SELECT
            te.mat_id,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                     THEN ABS(qty_change) ELSE 0 END)::bigint AS prev_qty_sold
          FROM tracker_events te
          JOIN tracked_items ti ON ti.mat_id = te.mat_id AND ti.active = TRUE
          WHERE te.company_id = $1
            AND te.recorded_at > NOW() - ($2::int * 2 || ' hours')::interval
            AND te.recorded_at <= NOW() - ($2 || ' hours')::interval
          GROUP BY te.mat_id
        ),
        all_sales AS (
          SELECT
            te.mat_id,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                     THEN ABS(qty_change) ELSE 0 END)::bigint AS total_sold,
            SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                          AND te.recorded_at > NOW() - ($2::int * 2 || ' hours')::interval
                          AND te.recorded_at <= NOW() - ($2 || ' hours')::interval
                     THEN ABS(qty_change) ELSE 0 END)::bigint AS prev_total_sold
          FROM tracker_events te
          WHERE te.mat_id IN (SELECT mat_id FROM this_co)
            AND te.recorded_at > NOW() - ($2::int * 2 || ' hours')::interval
          GROUP BY te.mat_id
        ),
        company_ranks AS (
          SELECT
            te.mat_id,
            te.company_id,
            RANK() OVER (
              PARTITION BY te.mat_id
              ORDER BY SUM(CASE WHEN event_type IN ('partial_fill','full_fill')
                                THEN ABS(qty_change) ELSE 0 END) DESC
            ) AS rank
          FROM tracker_events te
          WHERE te.mat_id IN (SELECT mat_id FROM this_co)
            AND te.recorded_at > NOW() - ($2 || ' hours')::interval
          GROUP BY te.mat_id, te.company_id
        )
        SELECT
          tc.mat_id, tc.mat_name, tc.qty_placed, tc.qty_sold, tc.revenue, tc.qty_cancelled,
          COALESCE(pc.prev_qty_sold, 0)   AS prev_qty_sold,
          COALESCE(als.total_sold, 1)     AS total_sold,
          COALESCE(als.prev_total_sold,0) AS prev_total_sold,
          COALESCE(cr.rank, 0)            AS rank
        FROM this_co tc
        LEFT JOIN prev_co pc        ON pc.mat_id  = tc.mat_id
        LEFT JOIN all_sales als     ON als.mat_id = tc.mat_id
        LEFT JOIN company_ranks cr  ON cr.mat_id  = tc.mat_id AND cr.company_id = $1
        ORDER BY tc.qty_sold DESC`;
      evtParams = [companyId, hours];
    }
    const evtRes = await pool.query(evtSql, evtParams);

    // ── Current open orders (latest snapshot per tracked item) ──────────────
    const listRes = await pool.query(
      `SELECT
         s.mat_id,
         SUM(o.qty)::bigint  AS current_listed,
         MIN(o.unit_price)   AS min_price,
         MAX(o.unit_price)   AS max_price
       FROM tracker_orders o
       JOIN tracker_snapshots s ON s.id = o.snapshot_id
       WHERE o.company_id = $1
         AND s.id IN (
           SELECT DISTINCT ON (mat_id) id
           FROM tracker_snapshots
           ORDER BY mat_id, recorded_at DESC
         )
       GROUP BY s.mat_id`,
      [companyId]
    );

    const listMap = new Map(listRes.rows.map((r) => [r.mat_id, r]));

    // ── Merge ────────────────────────────────────────────────────────────────
    const itemMap = new Map();

    for (const row of evtRes.rows) {
      const listing   = listMap.get(row.mat_id) ?? {};
      const qtySold   = Number(row.qty_sold);
      const totalSold = Number(row.total_sold) || 1;
      const prevSold  = Number(row.prev_qty_sold);
      const prevTotal = Number(row.prev_total_sold) || 1;
      const salesPct  = totalSold > 0 ? (qtySold / totalSold) * 100 : 0;
      const prevPct   = prevTotal > 0 ? (prevSold / prevTotal) * 100 : 0;
      const revenue   = Number(row.revenue);

      itemMap.set(row.mat_id, {
        matId:         row.mat_id,
        matName:       row.mat_name,
        rank:          Number(row.rank) || null,
        salesPct:      Math.round(salesPct * 10) / 10,
        shareDelta:    Math.round((salesPct - prevPct) * 10) / 10,
        qtyPlaced:     Number(row.qty_placed),
        qtySold,
        revenue,
        avgPrice:      qtySold > 0 ? Math.round(revenue / qtySold) : null,
        qtyCancelled:  Number(row.qty_cancelled),
        currentListed: listing.current_listed ? Number(listing.current_listed) : 0,
        minPrice:      listing.min_price ? Number(listing.min_price) : null,
        maxPrice:      listing.max_price ? Number(listing.max_price) : null,
      });
    }

    // Include items with current listings but no events in this window
    for (const row of listRes.rows) {
      if (!itemMap.has(row.mat_id)) {
        itemMap.set(row.mat_id, {
          matId:         row.mat_id,
          matName:       null,
          rank:          null,
          salesPct:      0,
          shareDelta:    0,
          qtyPlaced:     0,
          qtySold:       0,
          revenue:       0,
          avgPrice:      null,
          qtyCancelled:  0,
          currentListed: Number(row.current_listed),
          minPrice:      Number(row.min_price),
          maxPrice:      Number(row.max_price),
        });
      }
    }

    // Fill missing matName from snapshots for listing-only rows
    const missingMatIds = [...itemMap.values()]
      .filter((i) => i.matName === null)
      .map((i) => i.matId);

    if (missingMatIds.length > 0) {
      const nameRes = await pool.query(
        `SELECT DISTINCT ON (mat_id) mat_id, mat_name
         FROM tracker_snapshots
         WHERE mat_id = ANY($1)
         ORDER BY mat_id, recorded_at DESC`,
        [missingMatIds]
      );
      for (const r of nameRes.rows) {
        const item = itemMap.get(r.mat_id);
        if (item) item.matName = r.mat_name;
      }
    }

    const items = [...itemMap.values()].sort((a, b) => b.revenue - a.revenue);

    const totals = items.reduce(
      (acc, i) => {
        const active = i.qtyPlaced > 0 || i.qtySold > 0 || i.currentListed > 0;
        return {
          qtyPlaced:     acc.qtyPlaced     + i.qtyPlaced,
          qtySold:       acc.qtySold       + i.qtySold,
          revenue:       acc.revenue       + i.revenue,
          qtyCancelled:  acc.qtyCancelled  + i.qtyCancelled,
          currentListed: acc.currentListed + i.currentListed,
          activeItems:   acc.activeItems   + (active ? 1 : 0),
          _rankSum:      acc._rankSum      + (i.rank ?? 0),
          _rankCount:    acc._rankCount    + (i.rank != null ? 1 : 0),
          _shareSum:     acc._shareSum     + i.salesPct,
          _shareCount:   acc._shareCount   + (i.salesPct > 0 ? 1 : 0),
        };
      },
      { qtyPlaced: 0, qtySold: 0, revenue: 0, qtyCancelled: 0, currentListed: 0, activeItems: 0, _rankSum: 0, _rankCount: 0, _shareSum: 0, _shareCount: 0 }
    );

    const avgRank = totals._rankCount > 0
      ? Math.round((totals._rankSum / totals._rankCount) * 10) / 10
      : null;
    const avgMarketshare = totals._shareCount > 0
      ? Math.round((totals._shareSum / totals._shareCount) * 10) / 10
      : 0;

    // When viewing another company, resolve their name from events
    let companyName = req.user.company_name;
    let companyLogo = req.user.company_logo ?? null;
    let companyTag  = req.user.company_tag  ?? '';
    if (isDevOrAdmin && req.query.companyId) {
      const nameRow = await pool.query(
        `SELECT company_name FROM tracker_events WHERE company_id = $1 LIMIT 1`,
        [companyId]
      );
      companyName = nameRow.rows[0]?.company_name ?? String(companyId);
      const userRow = await pool.query(
        `SELECT company_logo, company_tag FROM users WHERE company_id = $1 LIMIT 1`,
        [String(companyId)]
      );
      companyLogo = userRow.rows[0]?.company_logo ?? null;
      companyTag  = userRow.rows[0]?.company_tag  ?? '';
    }

    res.json({
      companyId:   String(companyId),
      companyName,
      companyLogo,
      companyTag,
      hours,
      items,
      totals: {
        qtyPlaced:      totals.qtyPlaced,
        qtySold:        totals.qtySold,
        revenue:        totals.revenue,
        qtyCancelled:   totals.qtyCancelled,
        currentListed:  totals.currentListed,
        activeItems:    totals.activeItems,
        avgRank,
        avgMarketshare,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
