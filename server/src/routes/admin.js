import { Router } from 'express';
import { randomUUID } from 'crypto';
import pool from '../database/db.js';
import { getRateLimitStatusAll } from '../services/gtApi.js';
import { getRecentErrors } from '../services/tracker.js';

const router = Router();

// In-memory admin token store (resets on server restart — intentional)
const adminTokens = new Set();

// ── Admin auth middleware ──────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Admin auth required' });
  if (!adminTokens.has(header.slice(7))) return res.status(401).json({ error: 'Invalid admin token' });
  next();
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return res.status(503).json({ error: 'Admin access not configured (ADMIN_PASSWORD not set)' });
  if (!password || password !== adminPassword) return res.status(401).json({ error: 'Invalid password' });

  const token = randomUUID();
  adminTokens.add(token);
  res.json({ token });
});

// POST /api/admin/logout
router.post('/logout', requireAdmin, (req, res) => {
  const token = req.headers.authorization.slice(7);
  adminTokens.delete(token);
  res.json({ ok: true });
});

// PATCH /api/admin/users/:userId/credits
router.patch('/users/:userId/credits', requireAdmin, async (req, res, next) => {
  try {
    const { delta } = req.body; // +1 or -1
    if (delta !== 1 && delta !== -1) return res.status(400).json({ error: 'delta must be 1 or -1' });
    const r = await pool.query(
      `UPDATE users
       SET credits_total = GREATEST(1, credits_total + $1)
       WHERE id = $2
       RETURNING credits_total`,
      [delta, req.params.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, credits_total: r.rows[0].credits_total });
  } catch (err) { next(err); }
});

// GET /api/admin/users
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.company_name, u.credits_used, u.credits_total, u.revoked,
              u.registered_at, u.last_seen,
              COALESCE(json_agg(json_build_object('matId', ti.mat_id, 'matName', ti.mat_name))
                FILTER (WHERE ti.mat_id IS NOT NULL), '[]') AS tracked_items
       FROM users u
       LEFT JOIN tracked_items ti ON ti.owner_user_id = u.id AND ti.active = TRUE
       GROUP BY u.id
       ORDER BY u.registered_at ASC`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/admin/tracked-items
router.get('/tracked-items', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT ti.mat_id, ti.mat_name, ti.active, ti.enabled_at,
              u.company_name AS owner,
              (SELECT recorded_at FROM tracker_snapshots
               WHERE mat_id = ti.mat_id
               ORDER BY recorded_at DESC LIMIT 1) AS last_snapshot_at
       FROM tracked_items ti
       LEFT JOIN users u ON u.id = ti.owner_user_id
       ORDER BY ti.mat_name ASC`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/admin/rate-limits
router.get('/rate-limits', requireAdmin, async (req, res, next) => {
  try {
    const statuses = getRateLimitStatusAll();
    if (!statuses.length) return res.json([]);

    // Enrich with company names from DB
    const keys = statuses.map((s) => s.apiKey);
    const r = await pool.query(
      `SELECT api_key, company_name FROM users WHERE api_key = ANY($1)`,
      [keys]
    );
    const nameMap = new Map(r.rows.map((row) => [row.api_key, row.company_name]));

    res.json(statuses.map(({ apiKey, ...rest }) => ({
      ...rest,
      companyName: nameMap.get(apiKey) ?? 'Unknown',
    })));
  } catch (err) { next(err); }
});

// GET /api/admin/errors
router.get('/errors', requireAdmin, (req, res) => {
  res.json(getRecentErrors());
});

// POST /api/admin/revoke/:userId
router.post('/revoke/:userId', requireAdmin, async (req, res, next) => {
  try {
    await pool.query(`UPDATE users SET revoked = TRUE WHERE id = $1`, [req.params.userId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/admin/untrack/:matId
// Force-disables a tracked item and refunds the credit to its owner.
router.post('/untrack/:matId', requireAdmin, async (req, res, next) => {
  try {
    const matId = Number(req.params.matId);
    const r = await pool.query(
      `UPDATE tracked_items SET active = FALSE
       WHERE mat_id = $1 AND active = TRUE
       RETURNING owner_user_id`,
      [matId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Item not found or already inactive' });
    const ownerId = r.rows[0].owner_user_id;
    if (ownerId) {
      await pool.query(
        `UPDATE users SET credits_used = GREATEST(0, credits_used - 1) WHERE id = $1`,
        [ownerId]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/admin/contracts
router.get('/contracts', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.type, c.company_name, c.mat_name, c.planet,
              c.max_daily_qty, c.status, c.created_at, c.bumped_at,
              c.active, c.owner_user_id
       FROM contracts c
       ORDER BY c.created_at DESC
       LIMIT 200`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/admin/interests
router.get('/interests', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT ci.id, ci.company_name AS from_company, ci.created_at,
              c.mat_name, c.type AS contract_type, c.planet,
              c.company_name AS owner_company
       FROM contract_interests ci
       JOIN contracts c ON c.id = ci.contract_id
       ORDER BY ci.created_at DESC
       LIMIT 200`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// DELETE /api/admin/contracts/:id  (force-remove)
router.delete('/contracts/:id', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE contracts SET active = FALSE, status = 'cancelled'
       WHERE id = $1 AND active = TRUE
       RETURNING id`,
      [Number(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Contract not found or already inactive' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
