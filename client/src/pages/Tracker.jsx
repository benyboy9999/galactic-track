import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import { api } from '../api';
import Spinner from '../components/Spinner';

// ── Constants ──────────────────────────────────────────────────────────────────

const ITEMS = [
  { matId: 3,  matName: 'Concrete',   color: '#a78bfa' },
  { matId: 2,  matName: 'Iron',       color: '#60a5fa' },
  { matId: 92, matName: 'Prefab Kit', color: '#34d399' },
];

const HOURS_OPTIONS = [
  { hours: 1,   label: '1h'  },
  { hours: 4,   label: '4h'  },
  { hours: 8,   label: '8h'  },
  { hours: 24,  label: '24h' },
  { hours: 72,  label: '3d'  },
  { hours: 168, label: '7d'  },
  { hours: 720, label: '30d' },
];

// ── Formatters ─────────────────────────────────────────────────────────────────

const usd  = (v) => v > 0 ? `$${(v / 100).toFixed(2)}` : '—';
const usdK = (v) => {
  if (!v) return '—';
  const d = v / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(0)}`;
};
const qty = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};
const fmtTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// ── Tooltips ───────────────────────────────────────────────────────────────────

function PriceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#13132a', border: '1px solid #1e1e3a', padding: '8px 12px', fontSize: 12, borderRadius: 6 }}>
      <div style={{ color: '#6b6b8a', marginBottom: 4 }}>{fmtTime(d.recorded_at)}</div>
      <div>Price: <strong>{usd(d.current_price)}</strong></div>
      <div>Supply: <strong>{qty(d.total_qty_available)}</strong></div>
    </div>
  );
}

function ActivityTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#13132a', border: '1px solid #1e1e3a', padding: '8px 12px', fontSize: 12, borderRadius: 6 }}>
      <div style={{ color: '#6b6b8a', marginBottom: 4 }}>{fmtTime(d.recorded_at)}</div>
      {Number(d.qty_sold_since_prev) > 0 && <div>Sold: <strong style={{ color: '#f87171' }}>{qty(d.qty_sold_since_prev)}</strong></div>}
      {Number(d.qty_listed_since_prev) > 0 && <div>Listed: <strong style={{ color: '#34d399' }}>{qty(d.qty_listed_since_prev)}</strong></div>}
    </div>
  );
}

// ── Reusable components ────────────────────────────────────────────────────────

function StatChip({ label, value, color }) {
  return (
    <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 16px', minWidth: 110 }}>
      <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? '#e0e0f0', fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function ShareBar({ pct, color }) {
  return (
    <div style={{ width: 72, height: 5, background: '#1e1e3a', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color }} />
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
      {children}
    </div>
  );
}

// ── Company activity table ─────────────────────────────────────────────────────

const ACTIVITY_COLS = [
  { key: 'current_listed', label: 'Supply now'   },
  { key: 'supply_pct',     label: 'Supply %'     },
  { key: 'qty_placed',     label: 'Placed'       },
  { key: 'qty_sold',       label: 'Sold'         },
  { key: 'sales_pct',      label: 'Sales %'      },
  { key: 'revenue',        label: 'Revenue'      },
  { key: 'avg_sale_price', label: 'Avg price'    },
  { key: 'qty_cancelled',  label: 'Cancelled'    },
  { key: 'net',            label: 'Net'          },
];

function CompanyActivity({ data, hours, color }) {
  const [sort, setSort] = useState({ key: 'current_listed', dir: -1 }); // desc by default

  if (!data || !data.rows.filter((r) => r.company_name !== 'Federal Reserve').length) {
    return <div style={{ color: '#3a3a55', fontSize: 12 }}>No company activity yet — collecting data.</div>;
  }

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: -1 });
  }

  const rows = data.rows.filter((r) => r.company_name !== 'Federal Reserve');

  const totalListed = rows.reduce((s, r) => s + Number(r.current_listed), 0);
  const totalSold   = rows.reduce((s, r) => s + Number(r.qty_sold), 0);

  const sorted = [...rows]
    .map((r) => ({
      ...r,
      net:            r.qty_placed - r.qty_sold - r.qty_cancelled,
      avg_sale_price: r.qty_sold > 0 ? Math.round(r.revenue / r.qty_sold) : 0,
      supply_pct:     totalListed > 0 ? +((r.current_listed / totalListed) * 100).toFixed(1) : 0,
      sales_pct:      totalSold   > 0 ? +((r.qty_sold       / totalSold)   * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => {
      const av = a[sort.key] ?? 0;
      const bv = b[sort.key] ?? 0;
      return av < bv ? sort.dir : av > bv ? -sort.dir : 0;
    });

  const thStyle = (key) => ({
    textAlign: 'right', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    color: sort.key === key ? '#c0c0d8' : '#6b6b8a',
  });

  return (
    <div>
      <SectionLabel>Company activity — last {hours}h · click columns to sort</SectionLabel>
      <table style={{ fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: '#6b6b8a' }}>Company</th>
            {ACTIVITY_COLS.map(({ key, label }) => (
              <th key={key} style={thStyle(key)} onClick={() => toggleSort(key)}>
                {label}{sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.company_id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
              <td style={{ color: '#c0c0d8', fontWeight: 500 }}>{row.company_name}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {qty(row.current_listed)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <ShareBar pct={row.supply_pct} color={color} />
                  <span style={{ color, minWidth: 38 }}>{row.supply_pct > 0 ? `${row.supply_pct}%` : '—'}</span>
                </div>
              </td>
              <td style={{ textAlign: 'right', color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                {row.qty_placed > 0 ? `+${qty(row.qty_placed)}` : '—'}
              </td>
              <td style={{ textAlign: 'right', color: row.qty_sold > 0 ? '#f87171' : '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
                {row.qty_sold > 0 ? qty(row.qty_sold) : '—'}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <ShareBar pct={row.sales_pct} color="#f87171" />
                  <span style={{ color: row.sales_pct > 0 ? '#f87171' : '#3a3a55', minWidth: 38 }}>{row.sales_pct > 0 ? `${row.sales_pct}%` : '—'}</span>
                </div>
              </td>
              <td style={{ textAlign: 'right', color: row.revenue > 0 ? '#fbbf24' : '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
                {row.revenue > 0 ? usdK(row.revenue) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums' }}>
                {row.avg_sale_price > 0 ? usd(row.avg_sale_price) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums' }}>
                {row.qty_cancelled > 0 ? qty(row.qty_cancelled) : '—'}
              </td>
              <td style={{
                textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 11,
                color: row.net > 0 ? '#34d399' : row.net < 0 ? '#f87171' : '#3a3a55',
              }}>
                {row.net !== 0 ? `${row.net > 0 ? '+' : ''}${qty(row.net)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: '#3a3a55', marginTop: 8 }}>
        Placed = new listings + restocks · Sold = confirmed fills at lowest price · Cancelled = removed while cheaper orders exist
      </div>
    </div>
  );
}

// ── Item panel ─────────────────────────────────────────────────────────────────

function ItemPanel({ item, hours, refreshTick }) {
  const [snapshots,       setSnapshots]       = useState([]);
  const [activity,        setActivity]        = useState([]);
  const [companyActivity, setCompanyActivity] = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]      = useState(false);
  const [error,           setError]           = useState(null);
  const hasData = snapshots.length > 0;

  const load = useCallback(async () => {
    if (hasData) setRefreshing(true); else setLoading(true);
    try {
      const [snaps, act, compAct] = await Promise.all([
        api.trackerSnapshots(item.matId, 300),
        api.trackerActivity(item.matId, hours),
        api.trackerCompanyActivity(item.matId, hours),
      ]);
      setSnapshots(snaps);
      setActivity(act);
      setCompanyActivity(compAct);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [item.matId, hours, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 32 }}><Spinner /></div>;
  if (error)   return <div style={{ padding: 16, color: '#f87171', fontSize: 13 }}>{error}</div>;

  const latest = snapshots[snapshots.length - 1];
  const cutoff = Date.now() - hours * 3_600_000;
  const chartSnaps = snapshots.filter((s) => new Date(s.recorded_at).getTime() >= cutoff);

  const oldest = chartSnaps[0];
  const priceChange = latest && oldest && oldest.current_price > 0
    ? ((latest.current_price - oldest.current_price) / oldest.current_price * 100).toFixed(1)
    : null;
  const supplyChange = latest && oldest
    ? Number(latest.total_qty_available) - Number(oldest.total_qty_available)
    : null;

  const totalSold   = activity.reduce((s, r) => s + Number(r.qty_sold_since_prev), 0);
  const totalListed = activity.reduce((s, r) => s + Number(r.qty_listed_since_prev), 0);
  const avgSold     = activity.length > 0 ? Math.round(totalSold / activity.length) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <h3 style={{ margin: 0, color: item.color, fontSize: 20 }}>{item.matName}</h3>
        {latest && <span style={{ color: '#6b6b8a', fontSize: 13 }}>last snapshot {fmtTime(latest.recorded_at)}</span>}
        {refreshing && <span style={{ color: '#3a3a55', fontSize: 12 }}>refreshing…</span>}
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatChip label="Current price"  value={latest ? usd(latest.current_price) : '—'} />
        <StatChip
          label={`Price Δ ${hours}h`}
          value={priceChange !== null ? `${priceChange > 0 ? '+' : ''}${priceChange}%` : '—'}
          color={priceChange > 0 ? '#f87171' : priceChange < 0 ? '#34d399' : undefined}
        />
        <StatChip label="Supply now"    value={latest ? qty(latest.total_qty_available) : '—'} />
        <StatChip
          label={`Supply Δ ${hours}h`}
          value={supplyChange !== null ? `${supplyChange >= 0 ? '+' : ''}${qty(supplyChange)}` : '—'}
          color={supplyChange < 0 ? '#f87171' : '#34d399'}
        />
        <StatChip label={`Sold ${hours}h`}   value={qty(totalSold)}   color="#f87171" />
        <StatChip label={`Listed ${hours}h`} value={qty(totalListed)} color="#34d399" />
        <StatChip label="Sold/min avg"   value={qty(avgSold)}    color={item.color} />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '14px 10px 6px' }}>
          <SectionLabel>Price over time</SectionLabel>
          {chartSnaps.length > 1 ? (
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={chartSnaps}>
                <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                <XAxis dataKey="recorded_at" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: '#6b6b8a' }} />
                <YAxis tickFormatter={(v) => usd(v)} tick={{ fontSize: 10, fill: '#6b6b8a' }} width={58} />
                <Tooltip content={<PriceTooltip />} />
                <Line type="monotone" dataKey="current_price" stroke={item.color} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: '#3a3a55', fontSize: 12, padding: 20 }}>Collecting data…</div>
          )}
        </div>

        <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '14px 10px 6px' }}>
          <SectionLabel>Units sold vs listed per minute</SectionLabel>
          {activity.some((a) => Number(a.qty_sold_since_prev) > 0 || Number(a.qty_listed_since_prev) > 0) ? (
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={activity}>
                <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                <XAxis dataKey="recorded_at" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: '#6b6b8a' }} />
                <YAxis tickFormatter={qty} tick={{ fontSize: 10, fill: '#6b6b8a' }} width={44} />
                <Tooltip content={<ActivityTooltip />} />
                <Bar dataKey="qty_listed_since_prev" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} stackId="a" />
                <Bar dataKey="qty_sold_since_prev"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} stackId="b" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: '#3a3a55', fontSize: 12, padding: 20 }}>Need ≥2 snapshots with activity.</div>
          )}
        </div>
      </div>

      {/* Company activity */}
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: 16 }}>
        <CompanyActivity data={companyActivity} hours={hours} color={item.color} />
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Tracker() {
  const [hours,        setHours]       = useState(24);
  const [status,       setStatus]      = useState(null);
  const [activeTab,    setActiveTab]   = useState(ITEMS[0].matId);
  const [refreshTick,  setRefreshTick] = useState(0);
  const timerRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try { setStatus(await api.trackerStatus()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadStatus();
    timerRef.current = setInterval(loadStatus, 30_000);
    return () => clearInterval(timerRef.current);
  }, [loadStatus]);

  const activeItem = ITEMS.find((i) => i.matId === activeTab);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>Market Tracker</h2>
          {status && (
            <div style={{ fontSize: 12, color: '#6b6b8a', marginTop: 3 }}>
              {status.running ? '● Live' : '○ Stopped'} &nbsp;·&nbsp;
              {status.pollCount} polls &nbsp;·&nbsp;
              every {status.intervalMs / 1000}s
              {status.lastError && (
                <span style={{ color: '#f87171', marginLeft: 8 }}>
                  Error: {status.lastError.item} — {status.lastError.message}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {HOURS_OPTIONS.map(({ hours: h, label }) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', border: 'none',
                background: hours === h ? '#3b3b6a' : '#1e1e3a',
                color: hours === h ? '#e0e0f0' : '#6b6b8a',
              }}
            >
              {label}
            </button>
          ))}
          <button
            className="btn-secondary"
            onClick={() => setRefreshTick((t) => t + 1)}
            style={{ marginLeft: 6 }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid #1e1e3a' }}>
        {ITEMS.map((item) => (
          <button
            key={item.matId}
            onClick={() => setActiveTab(item.matId)}
            style={{
              padding: '8px 20px', fontSize: 14, fontWeight: 600,
              border: 'none', cursor: 'pointer', borderRadius: '6px 6px 0 0',
              background: activeTab === item.matId ? '#13132a' : 'transparent',
              color: activeTab === item.matId ? item.color : '#6b6b8a',
              borderBottom: activeTab === item.matId ? `2px solid ${item.color}` : '2px solid transparent',
            }}
          >
            {item.matName}
          </button>
        ))}
      </div>

      {activeItem && (
        <ItemPanel key={`${activeItem.matId}-${hours}`} item={activeItem} hours={hours} refreshTick={refreshTick} />
      )}

      <div style={{ color: '#3a3a55', fontSize: 11, marginTop: 16 }}>
        Snapshots every 60s · Sales only counted when no cheaper orders exist (buyers hit lowest price first) · Green = listed, Red = sold
      </div>
    </div>
  );
}
