import { Router } from 'express';
import pool from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ── Guild access middleware ────────────────────────────────────────────────────

async function requireTradeAccess(req, res, next) {
  const tag = req.user.company_tag;
  if (!tag) return res.status(403).json({ error: 'No guild on account' });
  const r = await pool.query('SELECT 1 FROM trade_guild_access WHERE guild_tag = $1', [tag]);
  if (!r.rows.length) return res.status(403).json({ error: 'Trade not available for your guild' });
  next();
}

// ── GET /api/trade/access ──────────────────────────────────────────────────────
router.get('/access', requireAuth, async (req, res, next) => {
  try {
    const tag = req.user.company_tag || '';
    if (!tag) return res.json({ access: false, guild_tag: '' });
    const r = await pool.query('SELECT 1 FROM trade_guild_access WHERE guild_tag = $1', [tag]);
    res.json({ access: r.rows.length > 0, guild_tag: tag });
  } catch (err) { next(err); }
});

// ── GET /api/trade ─────────────────────────────────────────────────────────────
router.get('/', requireAuth, requireTradeAccess, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT tl.id, tl.user_id, tl.company_name, tl.guild_tag, tl.mat_id, tl.mat_name,
              tl.price_type, tl.price_value, tl.stock_level, tl.location, tl.created_at,
              u.company_logo
       FROM trade_listings tl
       JOIN users u ON u.id = tl.user_id
       WHERE tl.guild_tag = $1
       ORDER BY tl.created_at DESC`,
      [req.user.company_tag]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ── POST /api/trade ────────────────────────────────────────────────────────────
router.post('/', requireAuth, requireTradeAccess, async (req, res, next) => {
  try {
    const { mat_id, mat_name, price_type, price_value, stock_level, location } = req.body;

    if (!mat_id || !mat_name) return res.status(400).json({ error: 'mat_id and mat_name are required' });
    if (!['fixed', 'market_offset', 'average'].includes(price_type)) return res.status(400).json({ error: 'Invalid price_type' });
    const effectiveValue = price_type === 'average' ? 0 : price_value;
    if (!Number.isInteger(effectiveValue)) return res.status(400).json({ error: 'price_value must be an integer' });

    const dup = await pool.query(
      'SELECT id FROM trade_listings WHERE user_id = $1 AND mat_id = $2',
      [req.user.id, Number(mat_id)]
    );
    if (dup.rows.length) return res.status(409).json({ error: 'You already have a listing for this item' });

    const r = await pool.query(
      `INSERT INTO trade_listings
         (user_id, company_id, company_name, guild_tag, mat_id, mat_name,
          price_type, price_value, stock_level, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, user_id, company_name, guild_tag, mat_id, mat_name,
                 price_type, price_value, stock_level, location, created_at`,
      [
        req.user.id,
        req.user.company_id,
        req.user.company_name,
        req.user.company_tag,
        Number(mat_id),
        mat_name,
        price_type,
        effectiveValue,
        stock_level || null,
        location || null,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/trade/:id ──────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireTradeAccess, async (req, res, next) => {
  try {
    const r = await pool.query(
      'DELETE FROM trade_listings WHERE id = $1 AND user_id = $2 RETURNING id',
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Listing not found or not yours' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/trade/:id ───────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireTradeAccess, async (req, res, next) => {
  try {
    const { price_type, price_value, stock_level, location } = req.body;
    if (!['fixed', 'market_offset', 'average'].includes(price_type)) return res.status(400).json({ error: 'Invalid price_type' });
    const effectiveValue = price_type === 'average' ? 0 : price_value;
    if (!Number.isInteger(effectiveValue)) return res.status(400).json({ error: 'price_value must be an integer' });

    const r = await pool.query(
      `UPDATE trade_listings
       SET price_type = $1, price_value = $2, stock_level = $3, location = $4
       WHERE id = $5 AND user_id = $6
       RETURNING id, user_id, company_name, guild_tag, mat_id, mat_name,
                 price_type, price_value, stock_level, location, created_at`,
      [price_type, effectiveValue, stock_level || null, location || null, Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Listing not found or not yours' });
    res.json(r.rows[0]);
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
// ?tag=ATS           — returns all listings for that guild (used by extension).
// ?tag=ATS&matId=45  — returns listings for that guild + item (legacy, still supported).
// ?demo=1            — returns a hardcoded test listing regardless of tag/matId.
router.get('/public', checkPublicRateLimit, async (req, res, next) => {
  try {
    if (req.query.demo === '1') {
      return res.json([{
        company_name: 'Test Corp',
        price_type: 'fixed',
        price_value: 1337,
        stock_level: 'high',
        location: 'Exchange Station',
        mat_id: 0,
        created_at: new Date().toISOString(),
      }]);
    }

    const { tag, matId } = req.query;
    if (!tag) return res.json([]);

    if (matId) {
      const r = await pool.query(
        `SELECT tl.company_name, tl.price_type, tl.price_value,
                tl.stock_level, tl.location, tl.mat_id, tl.created_at
         FROM trade_listings tl
         JOIN trade_guild_access tga ON tga.guild_tag = tl.guild_tag
         WHERE tl.guild_tag = $1 AND tl.mat_id = $2
         ORDER BY tl.price_value ASC`,
        [tag, Number(matId)]
      );
      return res.json(r.rows);
    }

    const r = await pool.query(
      `SELECT tl.company_name, tl.price_type, tl.price_value,
              tl.stock_level, tl.location, tl.mat_id, tl.created_at
       FROM trade_listings tl
       JOIN trade_guild_access tga ON tga.guild_tag = tl.guild_tag
       WHERE tl.guild_tag = $1
       ORDER BY tl.mat_id ASC, tl.price_value ASC`,
      [tag]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

export default router;
