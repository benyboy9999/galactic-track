import { Router } from 'express';
import pool from '../database/db.js';
import { getGameData } from '../services/gtApi.js';

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

export default router;
