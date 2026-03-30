import { Router } from 'express';
import pool from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ── GET /api/trade/access ──────────────────────────────────────────────────────
router.get('/access', requireAuth, (req, res) => {
  const tag = req.user.company_tag || '';
  res.json({ access: tag.length > 0, guild_tag: tag });
});

// ── GET /api/trade ─────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT tl.id, tl.user_id, tl.company_name, tl.guild_tag, tl.mat_id, tl.mat_name,
              tl.created_at, u.company_logo,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id',          ll.id,
                    'price_type',  ll.price_type,
                    'price_value', ll.price_value,
                    'stock_level', ll.stock_level,
                    'location',    ll.location
                  ) ORDER BY ll.price_value ASC
                ) FILTER (WHERE ll.id IS NOT NULL),
                '[]'
              ) AS locations
       FROM trade_listings tl
       JOIN users u ON u.id = tl.user_id
       LEFT JOIN trade_listing_locations ll ON ll.listing_id = tl.id
       WHERE tl.user_id = $1
       GROUP BY tl.id, u.company_logo
       ORDER BY tl.created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ── POST /api/trade ────────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { mat_id, mat_name } = req.body;
    if (!mat_id || !mat_name) return res.status(400).json({ error: 'mat_id and mat_name are required' });

    const dup = await pool.query(
      'SELECT id FROM trade_listings WHERE user_id = $1 AND mat_id = $2',
      [req.user.id, Number(mat_id)]
    );
    if (dup.rows.length) return res.status(409).json({ error: 'You already have a listing for this item' });

    const r = await pool.query(
      `INSERT INTO trade_listings (user_id, company_id, company_name, guild_tag, mat_id, mat_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, company_name, guild_tag, mat_id, mat_name, created_at`,
      [req.user.id, req.user.company_id, req.user.company_name, req.user.company_tag, Number(mat_id), mat_name]
    );
    res.status(201).json({ ...r.rows[0], locations: [] });
  } catch (err) { next(err); }
});

// ── DELETE /api/trade/:id ──────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      'DELETE FROM trade_listings WHERE id = $1 AND user_id = $2 RETURNING id',
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Listing not found or not yours' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/trade/:id/locations ──────────────────────────────────────────────
router.post('/:id/locations', requireAuth, async (req, res, next) => {
  try {
    const listing = await pool.query(
      'SELECT id FROM trade_listings WHERE id = $1 AND user_id = $2',
      [Number(req.params.id), req.user.id]
    );
    if (!listing.rows.length) return res.status(404).json({ error: 'Listing not found or not yours' });

    const { price_type, price_value, stock_level, location } = req.body;
    if (!['fixed', 'market_offset', 'average'].includes(price_type))
      return res.status(400).json({ error: 'Invalid price_type' });
    const effectiveValue = price_type === 'average' ? 0 : price_value;
    if (!Number.isInteger(effectiveValue)) return res.status(400).json({ error: 'price_value must be an integer' });

    const r = await pool.query(
      `INSERT INTO trade_listing_locations (listing_id, price_type, price_value, stock_level, location)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, listing_id, price_type, price_value, stock_level, location, created_at`,
      [Number(req.params.id), price_type, effectiveValue, stock_level || null, location || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

// ── PATCH /api/trade/:id/locations/:locId ──────────────────────────────────────
router.patch('/:id/locations/:locId', requireAuth, async (req, res, next) => {
  try {
    const listing = await pool.query(
      'SELECT id FROM trade_listings WHERE id = $1 AND user_id = $2',
      [Number(req.params.id), req.user.id]
    );
    if (!listing.rows.length) return res.status(404).json({ error: 'Listing not found or not yours' });

    const { price_type, price_value, stock_level, location } = req.body;
    if (!['fixed', 'market_offset', 'average'].includes(price_type))
      return res.status(400).json({ error: 'Invalid price_type' });
    const effectiveValue = price_type === 'average' ? 0 : price_value;
    if (!Number.isInteger(effectiveValue)) return res.status(400).json({ error: 'price_value must be an integer' });

    const r = await pool.query(
      `UPDATE trade_listing_locations
       SET price_type = $1, price_value = $2, stock_level = $3, location = $4
       WHERE id = $5 AND listing_id = $6
       RETURNING id, listing_id, price_type, price_value, stock_level, location, created_at`,
      [price_type, effectiveValue, stock_level || null, location || null, Number(req.params.locId), Number(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Location not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/trade/:id/locations/:locId ─────────────────────────────────────
router.delete('/:id/locations/:locId', requireAuth, async (req, res, next) => {
  try {
    const listing = await pool.query(
      'SELECT id FROM trade_listings WHERE id = $1 AND user_id = $2',
      [Number(req.params.id), req.user.id]
    );
    if (!listing.rows.length) return res.status(404).json({ error: 'Listing not found or not yours' });

    const r = await pool.query(
      'DELETE FROM trade_listing_locations WHERE id = $1 AND listing_id = $2 RETURNING id',
      [Number(req.params.locId), Number(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Location not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Rate limiter for public endpoint ──────────────────────────────────────────

const publicRateLimit = new Map(); // ip → { count, resetAt }

function checkPublicRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = publicRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    publicRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  if (entry.count >= 60) return res.status(429).json({ error: 'Too many requests' });
  entry.count++;
  next();
}

// ── GET /api/trade/public ──────────────────────────────────────────────────────
// Public endpoint for the Chrome extension. No auth required.
// ?tag=ATS           — returns all listings for that guild with nested locations.
// ?tag=ATS&matId=45  — filtered by material (legacy, still supported).
// ?demo=1            — returns a hardcoded test listing.
router.get('/public', checkPublicRateLimit, async (req, res, next) => {
  try {
    if (req.query.demo === '1') {
      return res.json([{
        company_name: 'Test Corp',
        mat_id: 0,
        price_type: 'fixed', price_value: 1337, stock_level: 'high', location: 'Exchange Station',
        locations: [{ price_type: 'fixed', price_value: 1337, stock_level: 'high', location: 'Exchange Station' }],
        created_at: new Date().toISOString(),
      }]);
    }

    const { tag, matId } = req.query;
    if (!tag) return res.json([]);

    const params = [tag];
    const matFilter = matId ? 'AND tl.mat_id = $2' : '';
    if (matId) params.push(Number(matId));

    const r = await pool.query(
      `SELECT tl.company_name, tl.mat_id, tl.mat_name, tl.created_at,
              -- best (lowest) location — flat fields for backward-compat with published extension
              (SELECT ll2.price_type  FROM trade_listing_locations ll2 WHERE ll2.listing_id = tl.id ORDER BY ll2.price_value ASC LIMIT 1) AS price_type,
              (SELECT ll2.price_value FROM trade_listing_locations ll2 WHERE ll2.listing_id = tl.id ORDER BY ll2.price_value ASC LIMIT 1) AS price_value,
              (SELECT ll2.stock_level FROM trade_listing_locations ll2 WHERE ll2.listing_id = tl.id ORDER BY ll2.price_value ASC LIMIT 1) AS stock_level,
              (SELECT ll2.location   FROM trade_listing_locations ll2 WHERE ll2.listing_id = tl.id ORDER BY ll2.price_value ASC LIMIT 1) AS location,
              -- full locations array for new extension
              json_agg(
                json_build_object(
                  'price_type',  ll.price_type,
                  'price_value', ll.price_value,
                  'stock_level', ll.stock_level,
                  'location',    ll.location
                ) ORDER BY ll.price_value ASC
              ) AS locations
       FROM trade_listings tl
       JOIN trade_listing_locations ll ON ll.listing_id = tl.id
       WHERE tl.guild_tag = $1 ${matFilter}
       GROUP BY tl.id
       ORDER BY tl.mat_id ASC`,
      params
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

export default router;
