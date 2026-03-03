import dotenv from 'dotenv';
dotenv.config();

import pool from './db.js';

const schema = `
  CREATE TABLE IF NOT EXISTS price_snapshots (
    id          SERIAL PRIMARY KEY,
    mat_id      INTEGER NOT NULL,
    mat_name    TEXT NOT NULL,
    current_price INTEGER,   -- in cents, -1 = no supply
    avg_price   INTEGER,     -- in cents, -1 = no history
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_price_snapshots_mat_id ON price_snapshots(mat_id);
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_recorded_at ON price_snapshots(recorded_at);

  CREATE TABLE IF NOT EXISTS game_data_cache (
    key         TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    cached_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- ── Tracker tables ────────────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS tracker_snapshots (
    id                  SERIAL PRIMARY KEY,
    mat_id              INTEGER NOT NULL,
    mat_name            TEXT NOT NULL,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_price       INTEGER NOT NULL,
    avg_price           INTEGER NOT NULL,
    total_qty_available BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tsnap_mat_id ON tracker_snapshots(mat_id);
  CREATE INDEX IF NOT EXISTS idx_tsnap_recorded_at ON tracker_snapshots(recorded_at);

  CREATE TABLE IF NOT EXISTS tracker_orders (
    id          SERIAL PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES tracker_snapshots(id) ON DELETE CASCADE,
    order_id    BIGINT NOT NULL,
    company_id  INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    unit_price  INTEGER NOT NULL,
    qty         BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tord_snapshot_id ON tracker_orders(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_tord_order_id    ON tracker_orders(order_id);

  CREATE TABLE IF NOT EXISTS inferred_sales (
    id            SERIAL PRIMARY KEY,
    mat_id        INTEGER NOT NULL,
    order_id      BIGINT NOT NULL,
    company_id    INTEGER NOT NULL,
    company_name  TEXT NOT NULL,
    unit_price    INTEGER NOT NULL,
    qty_sold      BIGINT NOT NULL,
    sale_type     TEXT NOT NULL,  -- 'partial' | 'full'
    inferred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot_a_id INTEGER NOT NULL,
    snapshot_b_id INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_isales_mat_id     ON inferred_sales(mat_id);
  CREATE INDEX IF NOT EXISTS idx_isales_company_id ON inferred_sales(company_id);
  CREATE INDEX IF NOT EXISTS idx_isales_inferred_at ON inferred_sales(inferred_at);

  -- Replaces inferred_sales with richer event tracking
  -- event_type: 'new_listing' | 'restocked' | 'partial_fill' | 'full_fill' | 'cancelled'
  -- qty_change: positive = units added to market, negative = units removed
  CREATE TABLE IF NOT EXISTS tracker_events (
    id            SERIAL PRIMARY KEY,
    mat_id        INTEGER NOT NULL,
    order_id      BIGINT NOT NULL,
    company_id    INTEGER NOT NULL,
    company_name  TEXT NOT NULL,
    unit_price    INTEGER NOT NULL,
    qty_change    BIGINT NOT NULL,
    event_type    TEXT NOT NULL,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot_a_id INTEGER,
    snapshot_b_id INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tevt_mat_id      ON tracker_events(mat_id);
  CREATE INDEX IF NOT EXISTS idx_tevt_company_id  ON tracker_events(company_id);
  CREATE INDEX IF NOT EXISTS idx_tevt_recorded_at ON tracker_events(recorded_at);
  CREATE INDEX IF NOT EXISTS idx_tevt_event_type  ON tracker_events(event_type);
`;

async function init() {
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('Database schema initialized.');
  } finally {
    client.release();
    await pool.end();
  }
}

init().catch((err) => {
  console.error('DB init failed:', err);
  process.exit(1);
});
