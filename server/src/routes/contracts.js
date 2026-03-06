import { Router } from 'express';
import pool from '../database/db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();

const MAX_LISTINGS   = 10;
const EXPIRE_INTERVAL = "INTERVAL '7 days'";

// GET /api/contracts?matId=&planet=&type=
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { matId, planet, type } = req.query;
    const userId = req.user?.id ?? null;

    const conditions = [
      'c.active = TRUE',
      `COALESCE(c.bumped_at, c.created_at) > NOW() - ${EXPIRE_INTERVAL}`,
    ];
    const params = [userId]; // $1 = viewer's user id (may be null)

    if (matId) {
      params.push(Number(matId));
      conditions.push(`c.mat_id = $${params.length}`);
    }
    if (planet) {
      params.push(planet);
      conditions.push(`c.planet ILIKE $${params.length}`);
    }
    if (type === 'buy' || type === 'sell') {
      params.push(type);
      conditions.push(`c.type = $${params.length}`);
    }

    const r = await pool.query(
      `SELECT c.id, c.type, c.company_name, c.mat_id, c.mat_name,
              c.planet, c.max_daily_qty, c.created_at, c.owner_user_id,
              c.status, c.bumped_at,
              u.company_logo, u.company_tag,
              CASE WHEN c.owner_user_id = $1 THEN
                COALESCE(json_agg(ci.company_name ORDER BY ci.created_at) FILTER (WHERE ci.id IS NOT NULL), '[]'::json)
              ELSE NULL END AS interests,
              EXISTS(SELECT 1 FROM contract_interests ci2 WHERE ci2.contract_id = c.id AND ci2.user_id = $1) AS i_am_interested
       FROM contracts c
       LEFT JOIN users u ON u.id = c.owner_user_id
       LEFT JOIN contract_interests ci ON ci.contract_id = c.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY c.id, u.company_logo, u.company_tag
       ORDER BY COALESCE(c.bumped_at, c.created_at) DESC`,
      params
    );

    res.json(r.rows);
  } catch (err) { next(err); }
});

// POST /api/contracts
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { type, matId, matName, planet, maxDailyQty } = req.body;

    if (!['buy', 'sell'].includes(type))       return res.status(400).json({ error: 'type must be buy or sell' });
    if (!matId || !matName)                    return res.status(400).json({ error: 'matId and matName are required' });
    if (!planet?.trim())                       return res.status(400).json({ error: 'planet is required' });
    if (!maxDailyQty || maxDailyQty < 1)      return res.status(400).json({ error: 'maxDailyQty must be at least 1' });

    // Enforce per-user listing cap
    const count = await pool.query(
      `SELECT COUNT(*) FROM contracts WHERE owner_user_id = $1 AND active = TRUE`,
      [req.user.id]
    );
    if (Number(count.rows[0].count) >= MAX_LISTINGS) {
      return res.status(400).json({ error: `You can have at most ${MAX_LISTINGS} active listings` });
    }

    const r = await pool.query(
      `INSERT INTO contracts (type, owner_user_id, company_name, mat_id, mat_name, planet, max_daily_qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [type, req.user.id, req.user.company_name, Number(matId), matName, planet.trim(), Number(maxDailyQty)]
    );

    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) { next(err); }
});

// DELETE /api/contracts/:id  (cancel)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE contracts SET active = FALSE, status = 'cancelled'
       WHERE id = $1 AND owner_user_id = $2 AND active = TRUE
       RETURNING id`,
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Contract not found or not yours' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/contracts/:id  (edit — auto-bumps if not on cooldown)
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { type, matId, matName, planet, maxDailyQty } = req.body;
    if (!['buy', 'sell'].includes(type))  return res.status(400).json({ error: 'type must be buy or sell' });
    if (!matId || !matName)               return res.status(400).json({ error: 'matId and matName are required' });
    if (!planet?.trim())                  return res.status(400).json({ error: 'planet is required' });
    if (!maxDailyQty || maxDailyQty < 1) return res.status(400).json({ error: 'maxDailyQty must be at least 1' });

    const r = await pool.query(
      `UPDATE contracts
       SET type = $1, mat_id = $2, mat_name = $3, planet = $4, max_daily_qty = $5,
           bumped_at = CASE
             WHEN bumped_at IS NULL OR bumped_at < NOW() - INTERVAL '1 hour' THEN NOW()
             ELSE bumped_at
           END
       WHERE id = $6 AND owner_user_id = $7 AND active = TRUE
       RETURNING bumped_at`,
      [type, Number(matId), matName, planet.trim(), Number(maxDailyQty), Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Contract not found or not yours' });
    res.json({ ok: true, bumped_at: r.rows[0].bumped_at });
  } catch (err) { next(err); }
});

// PATCH /api/contracts/:id/fulfill
router.patch('/:id/fulfill', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE contracts SET active = FALSE, status = 'fulfilled'
       WHERE id = $1 AND owner_user_id = $2 AND active = TRUE
       RETURNING id`,
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Contract not found or not yours' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/contracts/:id/bump  (max once per hour)
router.patch('/:id/bump', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE contracts
       SET bumped_at = NOW()
       WHERE id = $1 AND owner_user_id = $2 AND active = TRUE
         AND (bumped_at IS NULL OR bumped_at < NOW() - INTERVAL '1 hour')
       RETURNING bumped_at`,
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) {
      // Check if it's a cooldown issue vs not found
      const check = await pool.query(
        `SELECT bumped_at FROM contracts WHERE id = $1 AND owner_user_id = $2 AND active = TRUE`,
        [Number(req.params.id), req.user.id]
      );
      if (!check.rows.length) return res.status(404).json({ error: 'Contract not found or not yours' });
      const next = new Date(check.rows[0].bumped_at.getTime() + 3600_000);
      return res.status(429).json({ error: 'Bump on cooldown', nextBumpAt: next.toISOString() });
    }
    res.json({ ok: true, bumped_at: r.rows[0].bumped_at });
  } catch (err) { next(err); }
});

// POST /api/contracts/:id/interest  (mark as interested)
router.post('/:id/interest', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const c = await pool.query(
      `SELECT owner_user_id FROM contracts WHERE id = $1 AND active = TRUE`,
      [contractId]
    );
    if (!c.rows.length) return res.status(404).json({ error: 'Contract not found' });
    if (c.rows[0].owner_user_id === req.user.id) return res.status(400).json({ error: 'Cannot mark interest in your own listing' });
    await pool.query(
      `INSERT INTO contract_interests (contract_id, user_id, company_name)
       VALUES ($1, $2, $3) ON CONFLICT (contract_id, user_id) DO NOTHING`,
      [contractId, req.user.id, req.user.company_name]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/contracts/:id/interest  (remove interest)
router.delete('/:id/interest', requireAuth, async (req, res, next) => {
  try {
    await pool.query(
      `DELETE FROM contract_interests WHERE contract_id = $1 AND user_id = $2`,
      [Number(req.params.id), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
