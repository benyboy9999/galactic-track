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
// Returns whether the logged-in user's guild has trade access. Used by client
// to conditionally show the Trade tab.
router.get('/access', requireAuth, async (req, res, next) => {
  try {
    const tag = req.user.company_tag || '';
    if (!tag) return res.json({ access: false, guild_tag: '' });
    const r = await pool.query('SELECT 1 FROM trade_guild_access WHERE guild_tag = $1', [tag]);
    res.json({ access: r.rows.length > 0, guild_tag: tag });
  } catch (err) { next(err); }
});

// ── GET /api/trade ─────────────────────────────────────────────────────────────
// All listings for the caller's guild, newest first.
router.get('/', requireAuth, requireTradeAccess, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT tl.id, tl.user_id, tl.company_name, tl.mat_id, tl.mat_name,
              tl.price_type, tl.price_value, tl.created_at,
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
// Create a new listing.
router.post('/', requireAuth, requireTradeAccess, async (req, res, next) => {
  try {
    const { mat_id, mat_name, price_type, price_value } = req.body;

    if (!mat_id || !mat_name) return res.status(400).json({ error: 'mat_id and mat_name are required' });
    if (!['fixed', 'market_offset'].includes(price_type)) return res.status(400).json({ error: 'Invalid price_type' });
    if (!Number.isInteger(price_value)) return res.status(400).json({ error: 'price_value must be an integer' });

    const r = await pool.query(
      `INSERT INTO trade_listings
         (user_id, company_id, company_name, guild_tag, mat_id, mat_name, price_type, price_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, company_name, mat_id, mat_name, price_type, price_value, created_at`,
      [
        req.user.id,
        req.user.company_id,
        req.user.company_name,
        req.user.company_tag,
        Number(mat_id),
        mat_name,
        price_type,
        price_value,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/trade/:id ──────────────────────────────────────────────────────
// Delete own listing only.
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

// ── GET /api/trade/public ──────────────────────────────────────────────────────
// Public endpoint for the Chrome extension. No auth required.
// ?tag=ATS&matId=45  — returns listings for that guild + item.
// ?demo=1            — returns a hardcoded test listing regardless of tag/matId.
router.get('/public', async (req, res, next) => {
  try {
    if (req.query.demo === '1') {
      return res.json([{
        company_name: 'Test Corp',
        price_type: 'fixed',
        price_value: 1337,
        created_at: new Date().toISOString(),
      }]);
    }

    const { tag, matId } = req.query;
    if (!tag || !matId) return res.json([]);

    const r = await pool.query(
      `SELECT tl.company_name, tl.price_type, tl.price_value, tl.created_at
       FROM trade_listings tl
       JOIN trade_guild_access tga ON tga.guild_tag = tl.guild_tag
       WHERE tl.guild_tag = $1 AND tl.mat_id = $2
       ORDER BY tl.price_value ASC`,
      [tag, Number(matId)]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

export default router;
