import { Router } from 'express';
import pool from '../database/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/alerts — list caller's active price alerts
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, mat_id, mat_name, target_price, direction, created_at
       FROM price_alerts WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// POST /api/alerts — create a price alert
// Body: { matId, targetPrice }  (targetPrice in cents)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const matId       = Number(req.body.matId);
    const targetPrice = Math.round(Number(req.body.targetPrice));

    if (!matId || !targetPrice || targetPrice <= 0) {
      return res.status(400).json({ error: 'matId and targetPrice (>0) are required' });
    }

    // Confirm item is actively tracked (we need snapshots to check it)
    const tracked = await pool.query(
      `SELECT mat_name FROM tracked_items WHERE mat_id = $1 AND active = TRUE`,
      [matId]
    );
    if (!tracked.rows.length) {
      return res.status(400).json({ error: 'Item must be actively tracked to set a price alert' });
    }
    const matName = tracked.rows[0].mat_name;

    // Get current price from latest snapshot to determine direction
    const snap = await pool.query(
      `SELECT current_price FROM tracker_snapshots
       WHERE mat_id = $1 AND current_price > 0
       ORDER BY recorded_at DESC LIMIT 1`,
      [matId]
    );
    if (!snap.rows.length) {
      return res.status(400).json({ error: 'No price data available yet for this item' });
    }
    const currentPrice = snap.rows[0].current_price;

    if (targetPrice === currentPrice) {
      return res.status(400).json({ error: 'Target price is already the current price' });
    }
    const direction = targetPrice > currentPrice ? 'up' : 'down';

    // Cap alerts per user per item at 3
    const existing = await pool.query(
      `SELECT COUNT(*) FROM price_alerts WHERE user_id = $1 AND mat_id = $2`,
      [req.user.id, matId]
    );
    if (Number(existing.rows[0].count) >= 3) {
      return res.status(400).json({ error: 'Maximum 3 alerts per item' });
    }

    const r = await pool.query(
      `INSERT INTO price_alerts(user_id, mat_id, mat_name, target_price, direction)
       VALUES($1, $2, $3, $4, $5) RETURNING id, mat_id, mat_name, target_price, direction, created_at`,
      [req.user.id, matId, matName, targetPrice, direction]
    );
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/alerts/:id — remove an alert
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `DELETE FROM price_alerts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [Number(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Alert not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
