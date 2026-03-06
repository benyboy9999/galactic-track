import { Router } from 'express';
import pool from '../database/db.js';
import { getGameData } from '../services/gtApi.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/items
// Returns all game materials, flagging which are currently tracked and by whom.
router.get('/', async (req, res, next) => {
  try {
    const gameData = await getGameData();

    const TYPE_LABEL = {
      1:  'Metals',
      2:  'Construction Materials',
      3:  'Agricultural Products',
      4:  'Minerals',
      5:  'Gases and Liquids',
      6:  'Materials',
      7:  'Consumables',
      8:  'Plastics',
      9:  'Chemicals',
      10: 'Machinery',
      11: 'Electronics',
      12: 'Science',
      13: 'Ship Parts',
      14: 'Consumables',
    };

    // Build a flat list of all materials from gamedata
    const materials = (gameData.materials ?? []).map((item) => ({
      matId:    item.id,
      matName:  item.name,
      category: TYPE_LABEL[item.type] ?? null,
      tier:     item.tier ?? null,
    }));
    materials.sort((a, b) => a.matName.localeCompare(b.matName));
    // T9 items have no market data — exclude them entirely
    const filtered = materials.filter((m) => m.tier !== 9);

    // Overlay which are actively tracked
    const [tracked, snapCounts] = await Promise.all([
      pool.query(
        `SELECT ti.mat_id, u.company_name
         FROM tracked_items ti
         LEFT JOIN users u ON u.id = ti.owner_user_id
         WHERE ti.active = TRUE`
      ),
      pool.query(
        `SELECT mat_id, COUNT(*)::int AS count
         FROM tracker_snapshots
         WHERE recorded_at > NOW() - INTERVAL '24 hours'
         GROUP BY mat_id`
      ),
    ]);

    const POLL_INTERVAL_MS  = 60_000;
    const EXPECTED_24H      = Math.round(24 * 3_600_000 / POLL_INTERVAL_MS); // 1440
    const DATA_READY_THRESH = EXPECTED_24H * 0.8;

    const trackedMap   = new Map(tracked.rows.map((r) => [r.mat_id, r.company_name ?? null]));
    const snapCountMap = new Map(snapCounts.rows.map((r) => [r.mat_id, r.count]));

    const result = filtered.map((m) => ({
      ...m,
      tracked:   trackedMap.has(m.matId),
      trackedBy: trackedMap.get(m.matId) ?? null,
      dataReady: trackedMap.has(m.matId)
        ? (snapCountMap.get(m.matId) ?? 0) >= DATA_READY_THRESH
        : false,
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

    if (req.user.credits_used >= req.user.credits_total) {
      return res.status(403).json({ error: `Credit limit reached (max ${req.user.credits_total})` });
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
    const item = (gameData.materials ?? []).find((i) => i.id === matId);
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

    res.json({ ok: true, creditsUsed: req.user.credits_used + 1, creditsTotal: req.user.credits_total });
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

    res.json({ ok: true, creditsUsed: Math.max(0, req.user.credits_used - 1), creditsTotal: req.user.credits_total });
  } catch (err) {
    next(err);
  }
});

export default router;
