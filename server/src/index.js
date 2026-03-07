import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import exchangeRoutes from './routes/exchange.js';
import gamedataRoutes from './routes/gamedata.js';
import profitsRoutes from './routes/profits.js';
import trackerRoutes from './routes/tracker.js';
import authRoutes from './routes/auth.js';
import itemsRoutes from './routes/items.js';
import adminRoutes from './routes/admin.js';
import contractsRoutes from './routes/contracts.js';
import { getRateLimitStatus, getCompanyDetail } from './services/gtApi.js';
import { decryptApiKey } from './utils/apiKeyCrypto.js';
import { startTracker } from './services/tracker.js';
import pool from './database/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/exchange', exchangeRoutes);
app.use('/api/gamedata', gamedataRoutes);
app.use('/api/profits', profitsRoutes);
app.use('/api/tracker', trackerRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/contracts', contractsRoutes);

app.get('/api/health',    (req, res) => res.json({ ok: true }));
app.get('/api/ratelimit', (req, res) => res.json(getRateLimitStatus()));

// Error handler
app.use((err, req, res, _next) => {
  console.error(err.message);
  res.status(err.status ?? 500).json({ error: err.message });
});

// Serve built React app (production)
const publicDir = join(__dirname, '../public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => res.sendFile(join(publicDir, 'index.html')));

// Fetch and cache logos for users with active contracts but no logo stored yet.
async function backfillCompanyLogos() {
  try {
    const r = await pool.query(
      `SELECT DISTINCT u.id, u.company_id, u.api_key_encrypted
       FROM users u
       JOIN contracts c ON c.owner_user_id = u.id AND c.active = TRUE
       WHERE u.company_logo IS NULL AND u.company_id IS NOT NULL AND u.company_id != ''`
    );
    if (!r.rows.length) return;
    console.log(`Backfilling logos for ${r.rows.length} company/companies…`);
    for (const user of r.rows) {
      try {
        const detail = await getCompanyDetail(user.company_id, decryptApiKey(user.api_key_encrypted));
        await pool.query(
          `UPDATE users SET company_logo = $1, company_tag = $2 WHERE id = $3`,
          [detail.ic ?? null, detail.gTag ?? '', user.id]
        );
      } catch (e) {
        console.warn(`Logo backfill failed for user ${user.id}: ${e.message}`);
      }
    }
    console.log('Logo backfill complete.');
  } catch (e) {
    console.error('Logo backfill error:', e.message);
  }
}

async function expireContracts() {
  try {
    const r = await pool.query(
      `UPDATE contracts SET active = FALSE, status = 'expired'
       WHERE active = TRUE AND COALESCE(bumped_at, created_at) < NOW() - INTERVAL '7 days'`
    );
    if (r.rowCount > 0) console.log(`Expired ${r.rowCount} contract(s)`);
  } catch (e) {
    console.error('Contract expiry error:', e.message);
  }
}

async function cleanupOldOrders() {
  try {
    const r = await pool.query(
      `DELETE FROM tracker_orders
       WHERE snapshot_id IN (
         SELECT id FROM tracker_snapshots
         WHERE recorded_at < NOW() - INTERVAL '48 hours'
       )`
    );
    if (r.rowCount > 0) console.log(`Cleaned up ${r.rowCount} old tracker order row(s)`);
  } catch (e) {
    console.error('tracker_orders cleanup error:', e.message);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GT-Tracker server running on http://0.0.0.0:${PORT}`);
  if (process.env.TRACKER_ENABLED !== 'false') {
    startTracker();
  } else {
    console.log('Tracker disabled (TRACKER_ENABLED=false)');
  }
  // Expire stale contracts on startup and every 6 hours
  expireContracts();
  setInterval(expireContracts, 6 * 60 * 60 * 1000);
  // Prune raw orderbook data older than 48h (snapshots are kept forever)
  cleanupOldOrders();
  setInterval(cleanupOldOrders, 6 * 60 * 60 * 1000);
  // Backfill logos for users with active contracts who don't have one yet
  backfillCompanyLogos();
});
