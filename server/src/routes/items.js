import { Router } from 'express';
import pool from '../database/db.js';
import { getGameData } from '../services/gtApi.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const CREDITS_TOTAL = 3;

// GET /api/items
// Returns all game materials, flagging which are currently tracked and by whom.
router.get('/', async (req, res, next) => {
  try {
    const gameData = await getGameData();

    // Build a flat list of all materials from gamedata
    const materials = [];
    for (const [, item] of Object.entries(gameData.items ?? {})) {
      materials.push({ matId: item.id, matName: item.name, category: item.category ?? null });
    }
    materials.sort((a, b) => a.matName.localeCompare(b.matName));

    // Overlay which are actively tracked
    const tracked = await pool.query(
      `SELECT ti.mat_id, u.company_name
       FROM tracked_items ti
       LEFT JOIN users u ON u.id = ti.owner_user_id
       WHERE ti.active = TRUE`
    );
    const trackedMap = new Map(tracked.rows.map((r) => [r.mat_id, r.company_name ?? null]));

    const result = materials.map((m) => ({
      ...m,
      tracked:   trackedMap.has(m.matId),
      trackedBy: trackedMap.get(m.matId) ?? null,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/items/track
router.post('/track', requireAuth, async (req, res, next) => {
  try {
    const matId = Number(req.body.matId);
    if (!matId) return res.status(400).json({ error: 'matId is required' });

    if (req.user.credits_used >= CREDITS_TOTAL) {
      return res.status(403).json({ error: 'Credit limit reached (max 3)' });
    }

    // Check item isn't already tracked
    const existing = await pool.query(
      `SELECT mat_id FROM tracked_items WHERE mat_id = $1 AND active = TRUE`,
      [matId]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Item is already being tracked' });
    }

    // Get item name from gamedata
    const gameData = await getGameData();
    const item = Object.values(gameData.items ?? {}).find((i) => i.id === matId);
    if (!item) return res.status(404).json({ error: 'Item not found in gamedata' });

    await pool.query(
      `INSERT INTO tracked_items(mat_id, mat_name, owner_user_id, active)
       VALUES($1, $2, $3, TRUE)
       ON CONFLICT(mat_id) DO UPDATE SET owner_user_id=$3, active=TRUE`,
      [matId, item.name, req.user.id]
    );
    await pool.query(
      `UPDATE users SET credits_used = credits_used + 1 WHERE id = $1`,
      [req.user.id]
    );

    res.json({ ok: true, creditsUsed: req.user.credits_used + 1, creditsTotal: CREDITS_TOTAL });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/items/track/:matId
router.delete('/track/:matId', requireAuth, async (req, res, next) => {
  try {
    const matId = Number(req.params.matId);

    const r = await pool.query(
      `SELECT owner_user_id FROM tracked_items WHERE mat_id = $1 AND active = TRUE`,
      [matId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Item not tracked' });
    if (r.rows[0].owner_user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this tracked item' });
    }

    await pool.query(
      `UPDATE tracked_items SET active = FALSE WHERE mat_id = $1`,
      [matId]
    );
    await pool.query(
      `UPDATE users SET credits_used = GREATEST(0, credits_used - 1) WHERE id = $1`,
      [req.user.id]
    );

    res.json({ ok: true, creditsUsed: Math.max(0, req.user.credits_used - 1), creditsTotal: CREDITS_TOTAL });
  } catch (err) {
    next(err);
  }
});

export default router;
