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
import { getRateLimitStatus } from './services/gtApi.js';
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
});
