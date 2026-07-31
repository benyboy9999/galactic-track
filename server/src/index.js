import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import adminRoutes from './routes/admin.js';
import { getRateLimitStatus } from './services/gtApi.js';
import { startTracker } from './services/tracker.js';
import pool from './database/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
// Website (auth/items/company/contracts/profits/exchange/gamedata/tracker-status/alerts)
// and the guild-trade board (trade) are retired — the site is closed and those routes
// have no remaining consumers. The extension will just show no guild prices now.
// Only the admin API stays mounted.
app.use('/api/admin', adminRoutes);

app.get('/extension', (_req, res) => res.redirect(301, 'https://chromewebstore.google.com/detail/galactic-track-extension/mdlimpfkmgnclcfglcidnnnklhdjalbg'));

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

async function pruneAll() {
  try {
    // tracker_orders: keep only snapshots from the last 5 minutes (covers the 2 most recent per item)
    const ord = await pool.query(
      `DELETE FROM tracker_orders
       WHERE snapshot_id NOT IN (
         SELECT id FROM tracker_snapshots WHERE recorded_at > NOW() - INTERVAL '5 minutes'
       )`
    );
    if (ord.rowCount > 0) console.log(`Pruned ${ord.rowCount} old tracker_orders row(s)`);

    // tracker_snapshots: keep 30 days
    const snp = await pool.query(
      `DELETE FROM tracker_snapshots WHERE recorded_at < NOW() - INTERVAL '30 days'`
    );
    if (snp.rowCount > 0) console.log(`Pruned ${snp.rowCount} old tracker_snapshots row(s)`);

    // tracker_snapshots: compress history older than 24h to 15-minute resolution
    const cmp = await pool.query(
      `DELETE FROM tracker_snapshots
       WHERE recorded_at < NOW() - INTERVAL '1 day'
         AND recorded_at >= NOW() - INTERVAL '30 days'
         AND EXTRACT(MINUTE FROM recorded_at)::int % 15 <> 0`
    );
    if (cmp.rowCount > 0) console.log(`Compressed ${cmp.rowCount} old tracker_snapshots row(s) to 15-min resolution`);

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
  // Prune tracker tables: orders (keep 2 per item), snapshots + events (keep 30 days)
  pruneAll();
  setInterval(pruneAll, 6 * 60 * 60 * 1000);
});
