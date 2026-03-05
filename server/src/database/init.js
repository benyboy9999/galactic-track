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
    total_qty_available BIGINT NOT NULL,
    api_qty_sold        BIGINT,           -- priceHistory[0].qtySold from GT API (intra-day accumulator)
    api_qty_sold_date   TEXT,             -- priceHistory[0].date (to detect day rollovers)
    flash_qty           BIGINT NOT NULL DEFAULT 0  -- gap between api delta and attributed sales
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

  ALTER TABLE tracker_snapshots ADD COLUMN IF NOT EXISTS quick_sell_price INTEGER;

  -- ── Multi-tenant auth tables ───────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    api_key       VARCHAR(128) UNIQUE NOT NULL,
    session_token VARCHAR(128) UNIQUE NOT NULL,
    company_id    VARCHAR(64),
    company_name  VARCHAR(255),
    credits_used  INT NOT NULL DEFAULT 0,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen     TIMESTAMPTZ,
    revoked       BOOLEAN NOT NULL DEFAULT FALSE
  );

  CREATE INDEX IF NOT EXISTS idx_users_session_token ON users(session_token);
  CREATE INDEX IF NOT EXISTS idx_users_api_key       ON users(api_key);

  CREATE TABLE IF NOT EXISTS tracked_items (
    mat_id        INT PRIMARY KEY,
    mat_name      VARCHAR(255) NOT NULL,
    owner_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    enabled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active        BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

// Items that were previously hardcoded — seeded with no owner so the first
// user to register can claim them via the normal credit flow.
const LEGACY_ITEMS = [
  { matId: 2,  matName: 'Iron'       },
  { matId: 3,  matName: 'Concrete'   },
  { matId: 8,  matName: 'Silica'     },
  { matId: 34, matName: 'Limestone'  },
  { matId: 92, matName: 'Prefab Kit' },
];

async function init() {
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('Database schema initialized.');

    // Seed legacy tracked items if tracked_items table is empty
    const { rows } = await client.query('SELECT COUNT(*) FROM tracked_items');
    if (Number(rows[0].count) === 0) {
      for (const item of LEGACY_ITEMS) {
        await client.query(
          `INSERT INTO tracked_items(mat_id, mat_name, owner_user_id, active)
           VALUES($1, $2, NULL, TRUE)
           ON CONFLICT(mat_id) DO NOTHING`,
          [item.matId, item.matName]
        );
      }
      console.log(`Seeded ${LEGACY_ITEMS.length} legacy tracked items.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

init().catch((err) => {
  console.error('DB init failed:', err);
  process.exit(1);
});
