import pool from '../database/db.js';
import { decryptApiKey } from '../utils/apiKeyCrypto.js';

export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const token = header.slice(7);
  try {
    const r = await pool.query(
      `SELECT id, api_key_encrypted, company_id, company_name, company_logo, company_tag, credits_used, credits_total
       FROM users WHERE session_token = $1 AND revoked = FALSE`,
      [token]
    );
    if (r.rows.length) {
      const row = r.rows[0];
      req.user = { ...row, apiKey: row.api_key_encrypted ? decryptApiKey(row.api_key_encrypted) : null };
    }
  } catch { /* ignore */ }
  next();
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  try {
    const r = await pool.query(
      `UPDATE users
       SET last_seen = NOW()
       WHERE session_token = $1 AND revoked = FALSE
       RETURNING id, api_key_encrypted, company_id, company_name, company_logo, company_tag, credits_used, credits_total, max_listings, role`,
      [token]
    );
    if (!r.rows.length) {
      return res.status(401).json({ error: 'Invalid or revoked session' });
    }
    const row = r.rows[0];
    req.user = { ...row, apiKey: row.api_key_encrypted ? decryptApiKey(row.api_key_encrypted) : null };
    next();
  } catch (err) {
    next(err);
  }
}
