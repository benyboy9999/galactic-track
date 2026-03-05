import { Router } from 'express';
import { randomUUID } from 'crypto';
import pool from '../database/db.js';
import { getCompanyInfo } from '../services/gtApi.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const CREDITS_TOTAL = 3;

// POST /api/auth/login
// Validates the GT API key, upserts the user, and returns a session token.
// If there are unclaimed tracked_items (owner_user_id IS NULL), auto-assigns
// them up to the user's credit limit.
router.post('/login', async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey is required' });

    // Validate key against GT API
    let company;
    try {
      company = await getCompanyInfo(apiKey.trim());
    } catch (err) {
      return res.status(err.status === 401 || err.status === 403 ? 401 : 502)
        .json({ error: err.message });
    }

    const companyId   = String(company.id ?? company.companyId ?? '');
    const companyName = company.name ?? company.companyName ?? '';

    // Upsert user — preserve existing session_token on re-login
    const upsert = await pool.query(
      `INSERT INTO users(api_key, session_token, company_id, company_name, last_seen)
       VALUES($1, $2, $3, $4, NOW())
       ON CONFLICT(api_key) DO UPDATE
         SET company_name = EXCLUDED.company_name,
             last_seen    = NOW(),
             revoked      = FALSE
       RETURNING id, session_token, credits_used, revoked`,
      [apiKey.trim(), randomUUID(), companyId, companyName]
    );
    const user = upsert.rows[0];

    // Auto-assign unclaimed items (legacy seed) up to credit limit
    const headroom = CREDITS_TOTAL - user.credits_used;
    if (headroom > 0) {
      const unclaimed = await pool.query(
        `SELECT mat_id FROM tracked_items
         WHERE owner_user_id IS NULL AND active = TRUE
         LIMIT $1`,
        [headroom]
      );
      if (unclaimed.rows.length > 0) {
        const ids = unclaimed.rows.map((r) => r.mat_id);
        await pool.query(
          `UPDATE tracked_items SET owner_user_id = $1 WHERE mat_id = ANY($2)`,
          [user.id, ids]
        );
        await pool.query(
          `UPDATE users SET credits_used = credits_used + $1 WHERE id = $2`,
          [ids.length, user.id]
        );
        user.credits_used += ids.length;
      }
    }

    res.json({
      sessionToken: user.session_token,
      companyName,
      creditsUsed:  user.credits_used,
      creditsTotal: CREDITS_TOTAL,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const items = await pool.query(
      `SELECT mat_id AS "matId", mat_name AS "matName"
       FROM tracked_items WHERE owner_user_id = $1 AND active = TRUE`,
      [req.user.id]
    );
    res.json({
      companyName:  req.user.company_name,
      creditsUsed:  req.user.credits_used,
      creditsTotal: CREDITS_TOTAL,
      trackedItems: items.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
// Regenerates the session token — invalidates the old one without deleting the user.
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE users SET session_token = $1 WHERE id = $2`,
      [randomUUID(), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
