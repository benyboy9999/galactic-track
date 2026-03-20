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
import companyRoutes from './routes/company.js';
import alertsRoutes from './routes/alerts.js';
import { getRateLimitStatus, getCompanyDetail } from './services/gtApi.js';
import { decryptApiKey } from './utils/apiKeyCrypto.js';
import { optionalAuth } from './middleware/auth.js';
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
app.use('/api/company',   companyRoutes);
app.use('/api/alerts',    alertsRoutes);

app.get('/api/health',    (req, res) => res.json({ ok: true }));
app.get('/api/ratelimit', (req, res) => res.json(getRateLimitStatus()));

// POST /api/pageview — fire-and-forget page analytics (no auth lookup needed)
app.post('/api/pageview', (req, res) => {
  const page   = String(req.body?.page ?? '').slice(0, 128);
  const userId = req.body?.userId ? Number(req.body.userId) : null;
  if (page) pool.query(
    `INSERT INTO page_views(page, user_id) VALUES($1, $2)`,
    [page, userId]
  ).catch(() => {});
  res.json({ ok: true });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error(err.message);
  res.status(err.status ?? 500).json({ error: err.message });
});

// Serve built React app (production)
const publicDir = join(__dirname, '../public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => res.sendFile(join(publicDir, 'index.html')));

// Fetch and cache logos for all registered users missing a logo.
async function backfillCompanyLogos() {
  try {
    const r = await pool.query(
      `SELECT id, company_id
       FROM users
       WHERE (company_logo IS NULL OR company_logo = '') AND company_id IS NOT NULL AND company_id != '' AND company_id != '0'`
    );
    if (!r.rows.length) return;
    console.log(`Backfilling logos for ${r.rows.length} company/companies…`);
    for (const user of r.rows) {
      try {
        const detail = await getCompanyDetail(user.company_id, null);
        await pool.query(
          `UPDATE users SET company_logo = $1, company_tag = $2 WHERE id = $3`,
          [detail.ic || null, detail.gTag || '', user.id]
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

async function pruneAll() {
  try {
    // tracker_orders: keep only the 2 most recent snapshots per item — everything older is never read
    const ord = await pool.query(
      `DELETE FROM tracker_orders
       WHERE snapshot_id NOT IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY mat_id ORDER BY recorded_at DESC) AS rn
           FROM tracker_snapshots
         ) ranked WHERE rn <= 2
       )`
    );
    if (ord.rowCount > 0) console.log(`Pruned ${ord.rowCount} old tracker_orders row(s)`);

    // tracker_snapshots: keep 30 days
    const snp = await pool.query(
      `DELETE FROM tracker_snapshots WHERE recorded_at < NOW() - INTERVAL '30 days'`
    );
    if (snp.rowCount > 0) console.log(`Pruned ${snp.rowCount} old tracker_snapshots row(s)`);

    // tracker_events: keep 30 days
    const evt = await pool.query(
      `DELETE FROM tracker_events WHERE recorded_at < NOW() - INTERVAL '30 days'`
    );
    if (evt.rowCount > 0) console.log(`Pruned ${evt.rowCount} old tracker_events row(s)`);

    // page_views: keep 90 days
    const pv = await pool.query(
      `DELETE FROM page_views WHERE recorded_at < NOW() - INTERVAL '90 days'`
    );
    if (pv.rowCount > 0) console.log(`Pruned ${pv.rowCount} old page_views row(s)`);
  } catch (e) {
    console.error('pruneAll error:', e.message);
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
  // Prune tracker tables: orders (keep 2 per item), snapshots + events (keep 30 days)
  pruneAll();
  setInterval(pruneAll, 6 * 60 * 60 * 1000);
  // Backfill logos for users with active contracts who don't have one yet
  backfillCompanyLogos();
});
