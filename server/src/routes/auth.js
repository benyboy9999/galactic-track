import { Router } from 'express';
import { randomUUID } from 'crypto';
import pool from '../database/db.js';
import { getCompanyInfo, getCompanyDetail } from '../services/gtApi.js';
import { requireAuth } from '../middleware/auth.js';
import { hashApiKey, encryptApiKey } from '../utils/apiKeyCrypto.js';

const router = Router();


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
    const isRealCompany = companyId && companyId !== '0';

    let upsert;

    // Step A: for real companies, try to find and update the existing account by company_id.
    // This handles API key rotation — same company logs in with a new key and keeps their account.
    if (isRealCompany) {
      upsert = await pool.query(
        `UPDATE users
         SET api_key = $1, api_key_encrypted = $2, company_name = $3, last_seen = NOW(), revoked = FALSE
         WHERE company_id = $4
         RETURNING id, session_token, credits_used, credits_total, revoked, role`,
        [hashApiKey(apiKey.trim()), encryptApiKey(apiKey.trim()), companyName, companyId]
      );
    }

    // Step B: no existing account for this company — insert new, or re-login with same key
    if (!upsert?.rows.length) {
      upsert = await pool.query(
        `INSERT INTO users(api_key, api_key_encrypted, session_token, company_id, company_name, last_seen)
         VALUES($1, $2, $3, $4, $5, NOW())
         ON CONFLICT(api_key) DO UPDATE
           SET api_key_encrypted = EXCLUDED.api_key_encrypted,
               company_name      = EXCLUDED.company_name,
               last_seen         = NOW(),
               revoked           = FALSE
         RETURNING id, session_token, credits_used, credits_total, revoked, role`,
        [hashApiKey(apiKey.trim()), encryptApiKey(apiKey.trim()), randomUUID(), companyId, companyName]
      );
    }

    const user = upsert.rows[0];

    // Auto-assign unclaimed items (legacy seed) up to credit limit
    const headroom = user.credits_total - user.credits_used;
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

    // Fire-and-forget: refresh logo + guild tag using the user's own API key
    getCompanyDetail(companyId, apiKey.trim()).then((detail) => {
      pool.query(
        `UPDATE users SET company_logo = $1, company_tag = $2 WHERE id = $3`,
        [detail.ic || null, detail.gTag || '', user.id]
      );
    }).catch(() => {});

    res.json({
      sessionToken: user.session_token,
      companyName,
      creditsUsed:  user.credits_used,
      creditsTotal: user.credits_total,
      id:           user.id,
      role:         user.role ?? 'user',
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
      id:           req.user.id,
      companyName:  req.user.company_name,
      creditsUsed:  req.user.credits_used,
      creditsTotal: req.user.credits_total,
      role:         req.user.role ?? 'user',
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

// DELETE /api/auth/account
// Revokes the user's account — releases their tracked items and deletes the record.
router.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const items = await pool.query(
      `UPDATE tracked_items SET active = FALSE, owner_user_id = NULL
       WHERE owner_user_id = $1 AND active = TRUE
       RETURNING mat_id, mat_name`,
      [req.user.id]
    );
    for (const { mat_id, mat_name } of items.rows) {
      pool.query(
        `INSERT INTO tracking_log(mat_id, mat_name, user_id, company_name, action, by_admin)
         VALUES($1, $2, $3, $4, 'untracked', FALSE)`,
        [mat_id, mat_name, req.user.id, req.user.company_name]
      ).catch(() => {});
      pool.query(
        `INSERT INTO notifications(user_id, type, mat_name, from_company)
         SELECT id, 'untracked', $1, $2 FROM users WHERE role = 'admin'`,
        [mat_name, req.user.company_name]
      ).catch(() => {});
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/dev-search?q=
// DEV ONLY — search registered users by company name for impersonation.
router.get('/dev-search', async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const q = (req.query.q ?? '').trim();
    const r = await pool.query(
      `SELECT company_name, company_id
       FROM users
       WHERE company_name ILIKE $1 AND company_id IS NOT NULL AND company_id != '0'
       ORDER BY company_name ASC
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// POST /api/auth/dev-login
// DEV ONLY — creates/reuses a local test user without a real GT API key.
// Accepts optional { companyName, companyId } to impersonate a real company for testing.
// Always returns 404 in production.
router.post('/dev-login', async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { companyName = 'Dev User', companyId = '0' } = req.body;
    const upsert = await pool.query(
      `INSERT INTO users(api_key, api_key_encrypted, session_token, company_id, company_name, last_seen)
       VALUES($1, $2, $3, $4, $5, NOW())
       ON CONFLICT(api_key) DO UPDATE
         SET company_id = EXCLUDED.company_id,
             company_name = EXCLUDED.company_name,
             last_seen = NOW(), revoked = FALSE
       RETURNING id, session_token, credits_used, credits_total`,
      [hashApiKey('dev-local'), encryptApiKey('dev-local'), randomUUID(), companyId, companyName]
    );
    const user = upsert.rows[0];
    res.json({
      sessionToken: user.session_token,
      companyName,
      creditsUsed:  user.credits_used,
      creditsTotal: user.credits_total,
      id:           user.id,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
