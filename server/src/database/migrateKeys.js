/**
 * One-time migration: encrypt existing plaintext api_key values.
 *
 * Run after deploying the new code and setting API_KEY_SECRET in .env:
 *   node server/src/database/migrateKeys.js
 */
import dotenv from 'dotenv';
dotenv.config();

import pool from './db.js';
import { hashApiKey, encryptApiKey } from '../utils/apiKeyCrypto.js';

async function migrate() {
  const r = await pool.query(
    `SELECT id, api_key FROM users WHERE api_key_encrypted IS NULL`
  );
  console.log(`Found ${r.rows.length} row(s) to migrate`);

  for (const row of r.rows) {
    const hash      = hashApiKey(row.api_key);
    const encrypted = encryptApiKey(row.api_key);
    await pool.query(
      `UPDATE users SET api_key = $1, api_key_encrypted = $2 WHERE id = $3`,
      [hash, encrypted, row.id]
    );
    console.log(`Migrated user id=${row.id}`);
  }

  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
