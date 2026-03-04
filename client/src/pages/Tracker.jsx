import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import { api } from '../api';
import Spinner from '../components/Spinner';

// ── Constants ──────────────────────────────────────────────────────────────────

const ITEMS = [
  { matId: 2,  matName: 'Iron',       color: '#60a5fa' },
  { matId: 3,  matName: 'Concrete',   color: '#a78bfa' },
  { matId: 8,  matName: 'Silica',     color: '#f59e0b' },
  { matId: 34, matName: 'Limestone',  color: '#94a3b8' },
  { matId: 92, matName: 'Prefab Kit', color: '#34d399' },
];

const PAX_THRESHOLDS = [0.1, 0.5, 1, 2, 5];

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

// ── Recent activity feed ───────────────────────────────────────────────────────

const EVENT_LABEL = {
  new_listing:  { text: 'listed',      color: '#34d399' },
  restocked:    { text: 'restocked',   color: '#34d399' },
  partial_fill: { text: 'sold',        color: '#f87171' },
  full_fill:    { text: 'sold',        color: '#f87171' },
  cancelled:    { text: 'cancelled',   color: '#6b6b8a' },
};

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function RecentActivity({ events, matName }) {
  const [expanded, setExpanded] = useState(false);

  if (!events || events.length === 0) {
    return (
      <div>
        <SectionLabel>Recent activity</SectionLabel>
        <div style={{ color: '#3a3a55', fontSize: 12 }}>No events yet — collecting data.</div>
      </div>
    );
  }

  const visible = expanded ? events : events.slice(0, 5);

  return (
    <div>
      <SectionLabel>Recent activity</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visible.map((e, i) => {
          const { text, color } = EVENT_LABEL[e.event_type] ?? { text: e.event_type, color: '#6b6b8a' };
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
              <span style={{ color: '#c0c0d8', fontWeight: 500, minWidth: 0 }}>{e.company_name}</span>
              <span style={{ color }}>{text}</span>
              <span style={{ color: '#e0e0f0', fontVariantNumeric: 'tabular-nums' }}>{qty(Number(e.qty))}</span>
              <span style={{ color: '#6b6b8a' }}>{matName}</span>
              <span style={{ color: '#3a3a55', fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{timeAgo(e.recorded_at)}</span>
            </div>
          );
        })}
      </div>
      {events.length > 5 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: 8, background: 'none', border: 'none', color: '#6b6b8a', fontSize: 11, cursor: 'pointer', padding: 0 }}
        >
          {expanded ? '▲ show less' : `▼ show ${events.length - 5} more`}
        </button>
      )}
    </div>
  );
}

// ── Company activity table ─────────────────────────────────────────────────────

const ACTIVITY_COLS = [
  { key: 'sales_pct',      label: 'Sales %'    },
  { key: 'qty_sold',       label: 'Sold'       },
  { key: 'revenue',        label: 'Revenue'    },
  { key: 'avg_sale_price', label: 'Avg price'  },
  { key: 'qty_placed',     label: 'Placed'     },
  { key: 'current_listed', label: 'Supply now' },
  { key: 'share_delta',    label: 'Growth'     },
];

function CompanyActivity({ data, hours, color, onAwards }) {
  const [sort, setSort] = useState({ key: 'sales_pct', dir: 1 }); // desc by default

  if (!data || !data.rows.filter((r) => r.company_name !== 'Federal Reserve').length) {
    return <div style={{ color: '#3a3a55', fontSize: 12 }}>No company activity yet — collecting data.</div>;
  }

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: -1 });
  }

  const rows = data.rows.filter((r) => r.company_name !== 'Federal Reserve');

  const totalListed  = rows.reduce((s, r) => s + Number(r.current_listed), 0);
  const totalSold    = rows.reduce((s, r) => s + Number(r.qty_sold), 0);
  const prevTotalSold = rows.reduce((s, r) => s + Number(r.prev_qty_sold || 0), 0);
  const hasPrevData  = prevTotalSold > 0;

  const sorted = [...rows]
    .map((r) => {
      const sales_pct    = totalSold   > 0 ? +((r.qty_sold       / totalSold)   * 100).toFixed(1) : 0;
      const prev_pct     = hasPrevData     ? +((Number(r.prev_qty_sold || 0) / prevTotalSold) * 100).toFixed(1) : null;
      return {
        ...r,
        net:            r.qty_placed - r.qty_sold - r.qty_cancelled,
        avg_sale_price: r.qty_sold > 0 ? Math.round(r.revenue / r.qty_sold) : 0,
        supply_pct:     totalListed > 0 ? +((r.current_listed / totalListed) * 100).toFixed(1) : 0,
        sales_pct,
        share_delta:    prev_pct !== null ? +(sales_pct - prev_pct).toFixed(1) : null,
      };
    })
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          Company activity — last {hours}h · click columns to sort
        </div>
        {onAwards && (
          <button onClick={onAwards} style={{
            padding: '1px 8px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
            border: '1px solid #1e1e3a', background: 'transparent', color: '#6b6b8a',
          }}>Awards</button>
        )}
      </div>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <ShareBar pct={row.sales_pct} color="#f87171" />
                  <span style={{ color: row.sales_pct > 0 ? '#f87171' : '#3a3a55', minWidth: 38 }}>{row.sales_pct > 0 ? `${row.sales_pct}%` : '—'}</span>
                </div>
              </td>
              <td style={{ textAlign: 'right', color: row.qty_sold > 0 ? '#f87171' : '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
                {row.qty_sold > 0 ? qty(row.qty_sold) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: row.revenue > 0 ? '#fbbf24' : '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
                {row.revenue > 0 ? usdK(row.revenue) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums' }}>
                {row.avg_sale_price > 0 ? usd(row.avg_sale_price) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                {row.qty_placed > 0 ? `+${qty(row.qty_placed)}` : '—'}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {qty(row.current_listed)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: row.share_delta === null ? '#3a3a55' : row.share_delta > 0 ? '#34d399' : row.share_delta < 0 ? '#f87171' : '#6b6b8a' }}>
                {row.share_delta === null ? '—' : row.share_delta > 0 ? `+${row.share_delta}%` : `${row.share_delta}%`}
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

// ── Modal ──────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 10,
          padding: '16px 20px', minWidth: 420, maxWidth: 640, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Item panel ─────────────────────────────────────────────────────────────────

function groupSnapshots(data, groupBy) {
  if (groupBy === '1m') return data;
  const buckets = new Map();
  for (const row of data) {
    const d = new Date(row.recorded_at);
    if (groupBy === '15m') d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    else                   d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    if (!buckets.has(key)) buckets.set(key, { recorded_at: key, prices: [], total_qty_available: 0 });
    const b = buckets.get(key);
    b.prices.push(Number(row.current_price));
    b.total_qty_available = row.total_qty_available; // keep last
  }
  return [...buckets.values()].map((b) => ({
    recorded_at:        b.recorded_at,
    current_price:      Math.round(b.prices.reduce((s, v) => s + v, 0) / b.prices.length),
    total_qty_available: b.total_qty_available,
  }));
}

function groupActivity(data, groupBy) {
  if (groupBy === '1m') return data;
  const buckets = new Map();
  for (const row of data) {
    const d = new Date(row.recorded_at);
    if (groupBy === '15m')  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    else if (groupBy === 'hour') d.setMinutes(0, 0, 0);
    else d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!buckets.has(key)) buckets.set(key, { recorded_at: key, qty_sold_since_prev: 0, qty_listed_since_prev: 0 });
    const b = buckets.get(key);
    b.qty_sold_since_prev   += Number(row.qty_sold_since_prev);
    b.qty_listed_since_prev += Number(row.qty_listed_since_prev);
  }
  return [...buckets.values()];
}

function ItemPanel({ item, hours, refreshTick }) {
  const [snapshots,       setSnapshots]       = useState([]);
  const [activity,        setActivity]        = useState([]);
  const [companyActivity, setCompanyActivity] = useState(null);
  const [recentEvents,    setRecentEvents]    = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]      = useState(false);
  const [error,           setError]           = useState(null);
  const [priceGroup,      setPriceGroup]      = useState('15m');
  const [activityGroup,   setActivityGroup]   = useState('15m');
  const [paxThreshold,    setPaxThreshold]    = useState(0.1);
  const [barDetail,       setBarDetail]       = useState(null); // { from, to, events, loading }
  const [patterns,        setPatterns]        = useState(null); // { byHour, byDow } | null=not loaded
  const [patternsOpen,    setPatternsOpen]    = useState(false);
  const [awardsOpen,      setAwardsOpen]      = useState(false);
  const [awardsHours,     setAwardsHours]     = useState(24);
  const [awardsData,      setAwardsData]      = useState(null);
  const [awardsLoading,   setAwardsLoading]   = useState(false);
  const activeBarIndex = useRef(null);
  const hasData = snapshots.length > 0;

  const load = useCallback(async () => {
    if (hasData) setRefreshing(true); else setLoading(true);
    try {
      const [snaps, act, compAct, recent] = await Promise.all([
        api.trackerSnapshots(item.matId, 300),
        api.trackerActivity(item.matId, hours),
        api.trackerCompanyActivity(item.matId, hours),
        api.trackerRecent(item.matId, 10),
      ]);
      setSnapshots(snaps);
      setActivity(act);
      setCompanyActivity(compAct);
      setRecentEvents(recent);
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

  const compRows       = (companyActivity?.rows || []).filter((r) => r.company_name !== 'Federal Reserve');
  const compTotalSold  = compRows.reduce((s, r) => s + Number(r.qty_sold), 0);
  const prevTotalSold  = compRows.reduce((s, r) => s + Number(r.prev_qty_sold || 0), 0);
  const currPax        = compTotalSold > 0 ? compRows.filter((r) => (Number(r.qty_sold) / compTotalSold) * 100 >= paxThreshold).length : null;
  const prevPax        = prevTotalSold > 0 ? compRows.filter((r) => (Number(r.prev_qty_sold || 0) / prevTotalSold) * 100 >= paxThreshold).length : null;
  const paxDelta       = currPax !== null && prevPax !== null ? currPax - prevPax : null;
  const cyclePaxThreshold = () => {
    const next = PAX_THRESHOLDS[(PAX_THRESHOLDS.indexOf(paxThreshold) + 1) % PAX_THRESHOLDS.length];
    setPaxThreshold(next);
  };

  const statsRows = [
    { label: 'Price',                                   value: latest ? usd(latest.current_price) : '—', color: undefined },
    { label: `Δ ${hours}h`,                             value: priceChange !== null ? `${priceChange > 0 ? '+' : ''}${priceChange}%` : '—', color: priceChange > 0 ? '#f87171' : priceChange < 0 ? '#34d399' : undefined },
    { label: 'Supply',                                  value: latest ? qty(latest.total_qty_available) : '—', color: undefined },
    { label: `Δ ${hours}h`,                             value: supplyChange !== null ? `${supplyChange >= 0 ? '+' : ''}${qty(supplyChange)}` : '—', color: supplyChange < 0 ? '#f87171' : '#34d399' },
    { label: `Participants ≥${paxThreshold}%`, onClick: cyclePaxThreshold, value: currPax !== null ? String(currPax) : '—', color: undefined },
    { label: `Δ ${hours}h`,                             value: paxDelta !== null ? `${paxDelta >= 0 ? '+' : ''}${paxDelta}` : '—', color: paxDelta > 0 ? '#34d399' : paxDelta < 0 ? '#f87171' : undefined },
    { label: `Sold`,                                    value: qty(totalSold),   color: '#f87171' },
    { label: `Listed`,                                  value: qty(totalListed), color: '#34d399' },
    { label: 'Sold/hr avg',                             value: qty(avgSold * 60), color: item.color },
  ];

  async function openPatterns() {
    setPatternsOpen(true);
    if (patterns !== null) return; // already loaded
    try {
      const data = await api.trackerPatterns(item.matId);
      setPatterns(data);
    } catch {
      setPatterns({ byHour: [], byDow: [] });
    }
  }

  async function loadAwards(h) {
    setAwardsLoading(true);
    try {
      const data = await api.trackerAwards(item.matId, h);
      setAwardsData(data);
    } catch {
      setAwardsData({ rows: [] });
    } finally {
      setAwardsLoading(false);
    }
  }

  function openAwards() {
    setAwardsOpen(true);
    if (!awardsData) loadAwards(awardsHours);
  }

  async function handleBarClick(row) {
    if (!row?.recorded_at) return;
    const from = new Date(row.recorded_at);
    const to   = new Date(from);
    if      (activityGroup === '1m')   to.setSeconds(to.getSeconds() + 60);
    else if (activityGroup === '15m')  to.setMinutes(to.getMinutes() + 15);
    else if (activityGroup === 'hour') to.setHours(to.getHours() + 1);
    else                               to.setDate(to.getDate() + 1);

    // Toggle off if same bar clicked again
    if (barDetail?.from === from.toISOString()) { setBarDetail(null); return; }

    setBarDetail({ from: from.toISOString(), to: to.toISOString(), events: null, loading: true });
    try {
      const events = await api.trackerEvents(item.matId, from.toISOString(), to.toISOString());
      setBarDetail((d) => d ? { ...d, events, loading: false } : null);
    } catch {
      setBarDetail((d) => d ? { ...d, events: [], loading: false } : null);
    }
  }

  return (
    <div>
      {/* Refresh indicator */}
      {refreshing && <div style={{ color: '#3a3a55', fontSize: 11, marginBottom: 6 }}>refreshing…</div>}

      {/* 2-column grid: stats+activity | stacked charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>

        {/* Column 1: stats + recent activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 12px' }}>
            <SectionLabel>Stats</SectionLabel>
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {statsRows.map(({ label, value, color, onClick }, i) => (
                  <tr key={i}>
                    <td
                      style={{ color: '#6b6b8a', paddingBottom: 4, whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default' }}
                      onClick={onClick}
                      title={onClick ? 'Click to cycle threshold' : undefined}
                    >{label}</td>
                    <td style={{ color: color ?? '#e0e0f0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 12px', flex: 1 }}>
            <RecentActivity events={recentEvents} matName={item.matName} />
          </div>
        </div>

        {/* Column 2: charts stacked, each filling half the column height */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 10px 4px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <SectionLabel>Price · last snapshot {fmtTime(latest?.recorded_at)}</SectionLabel>
              <div style={{ display: 'flex', gap: 2 }}>
                {[['1m','1m'],['15m','15m'],['1h','hour']].map(([label, val]) => (
                  <button key={val} onClick={() => setPriceGroup(val)} style={{
                    padding: '1px 6px', fontSize: 10, borderRadius: 3, cursor: 'pointer', border: 'none',
                    background: priceGroup === val ? '#3b3b6a' : 'transparent',
                    color: priceGroup === val ? '#e0e0f0' : '#6b6b8a',
                  }}>{label}</button>
                ))}
              </div>
            </div>
            {chartSnaps.length > 1 ? (
              <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={groupSnapshots(chartSnaps, priceGroup)}>
                    <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                    <XAxis dataKey="recorded_at" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: '#6b6b8a' }}
                      interval={priceGroup === '1m' ? 59 : priceGroup === '15m' ? 3 : 0} />
                    <YAxis tickFormatter={(v) => usd(v)} tick={{ fontSize: 10, fill: '#6b6b8a' }} width={58}
                      domain={[
                        (min) => Math.round(min * 0.95),
                        (max) => Math.round(max * 1.05),
                      ]} />
                    <Tooltip content={<PriceTooltip />} cursor={{ stroke: 'rgba(59, 59, 106, 0.8)', strokeWidth: 1, fill: 'rgba(59, 59, 106, 0.15)' }} />
                    <Line type="monotone" dataKey="current_price" stroke={item.color} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: '#3a3a55', fontSize: 12, padding: 20 }}>Collecting data…</div>
            )}
          </div>
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 10px 4px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                Sold vs listed · per {activityGroup}
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {['1m', '15m', 'hour', 'day'].map((g) => (
                  <button key={g} onClick={() => setActivityGroup(g)} style={{
                    padding: '1px 6px', fontSize: 10, borderRadius: 3, cursor: 'pointer', border: 'none',
                    background: activityGroup === g ? '#3b3b6a' : 'transparent',
                    color: activityGroup === g ? '#e0e0f0' : '#6b6b8a',
                  }}>{g}</button>
                ))}
                <div style={{ width: 1, height: 10, background: '#1e1e3a', margin: '0 4px' }} />
                <button onClick={openPatterns} style={{
                  padding: '1px 6px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                  border: '1px solid #1e1e3a', background: 'transparent', color: '#6b6b8a',
                }}>Patterns</button>
              </div>
            </div>
            {(() => {
              const grouped = groupActivity(activity, activityGroup);
              const tickFmt = activityGroup === 'day'
                ? (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
                : fmtTime;
              return grouped.some((a) => Number(a.qty_sold_since_prev) > 0 || Number(a.qty_listed_since_prev) > 0) ? (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={grouped}
                      style={{ cursor: 'pointer' }}
                      onMouseMove={(s) => { activeBarIndex.current = s?.activeTooltipIndex ?? null; }}
                      onMouseLeave={() => { activeBarIndex.current = null; }}
                      onClick={() => { if (activeBarIndex.current != null) handleBarClick(grouped[activeBarIndex.current]); }}
                    >
                      <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                      <XAxis dataKey="recorded_at" tickFormatter={tickFmt} tick={{ fontSize: 10, fill: '#6b6b8a' }}
                        interval={activityGroup === '1m' ? 59 : activityGroup === '15m' ? 3 : 0} />
                      <YAxis tickFormatter={qty} tick={{ fontSize: 10, fill: '#6b6b8a' }} width={44} />
                      <Tooltip content={<ActivityTooltip />} cursor={{ fill: 'rgba(59, 59, 106, 0.35)' }} />
                      <Bar dataKey="qty_listed_since_prev" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} stackId="a" />
                      <Bar dataKey="qty_sold_since_prev"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} stackId="b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ color: '#3a3a55', fontSize: 12, padding: 20 }}>Need ≥2 snapshots with activity.</div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Patterns modal */}
      {patternsOpen && (
        <Modal title={`Activity patterns · ${item.matName} · all history`} onClose={() => setPatternsOpen(false)}>
          {!patterns ? (
            <Spinner />
          ) : patterns.byHour.length === 0 ? (
            <div style={{ color: '#3a3a55', fontSize: 12 }}>No data yet — patterns will populate as snapshots accumulate.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>By hour of day</div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={patterns.byHour} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#6b6b8a' }} interval={1} />
                      <YAxis tickFormatter={qty} tick={{ fontSize: 9, fill: '#6b6b8a' }} width={40} />
                      <Tooltip cursor={{ fill: 'rgba(59,59,106,0.35)' }} contentStyle={{ background: '#13132a', border: '1px solid #1e1e3a', fontSize: 11 }} />
                      <Bar dataKey="qty_listed" name="Listed" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} stackId="a" />
                      <Bar dataKey="qty_sold"   name="Sold"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} stackId="b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>By day of week</div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={patterns.byDow} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b6b8a' }} />
                      <YAxis tickFormatter={qty} tick={{ fontSize: 9, fill: '#6b6b8a' }} width={40} />
                      <Tooltip cursor={{ fill: 'rgba(59,59,106,0.35)' }} contentStyle={{ background: '#13132a', border: '1px solid #1e1e3a', fontSize: 11 }} />
                      <Bar dataKey="qty_listed" name="Listed" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} stackId="a" />
                      <Bar dataKey="qty_sold"   name="Sold"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} stackId="b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Bar drill-down modal */}
      {barDetail && (
        <Modal
          title={`Transactions · ${new Date(barDetail.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${activityGroup !== '1m' ? ` – ${new Date(barDetail.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} · ${item.matName}`}
          onClose={() => setBarDetail(null)}
        >
          {barDetail.loading ? (
            <Spinner />
          ) : barDetail.events?.length === 0 ? (
            <div style={{ color: '#3a3a55', fontSize: 12 }}>No events in this window.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {barDetail.events.map((e, i) => {
                const { text, color } = EVENT_LABEL[e.event_type] ?? { text: e.event_type, color: '#6b6b8a' };
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
                    <span style={{ color: '#c0c0d8', fontWeight: 500 }}>{e.company_name}</span>
                    <span style={{ color }}>{text}</span>
                    <span style={{ color: '#e0e0f0', fontVariantNumeric: 'tabular-nums' }}>{qty(Number(e.qty))}</span>
                    <span style={{ color: '#6b6b8a' }}>{item.matName}</span>
                    <span style={{ color: '#6b6b8a', fontVariantNumeric: 'tabular-nums' }}>@ {usd(e.unit_price)}</span>
                    <span style={{ color: '#3a3a55', fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtTime(e.recorded_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* Awards modal */}
      {awardsOpen && (
        <Modal title={`Top earners · ${item.matName}`} onClose={() => setAwardsOpen(false)}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {[{h:24,l:'1d'},{h:72,l:'3d'},{h:168,l:'7d'},{h:336,l:'14d'},{h:720,l:'30d'}].map(({h, l}) => (
              <button key={h} onClick={() => { setAwardsHours(h); loadAwards(h); }} style={{
                padding: '2px 8px', fontSize: 10, borderRadius: 3, cursor: 'pointer', border: 'none',
                background: awardsHours === h ? '#3b3b6a' : 'transparent',
                color: awardsHours === h ? '#e0e0f0' : '#6b6b8a',
              }}>{l}</button>
            ))}
          </div>
          {awardsLoading ? (
            <Spinner />
          ) : !awardsData?.rows?.length ? (
            <div style={{ color: '#3a3a55', fontSize: 12 }}>No sales data for this period yet.</div>
          ) : (
            <table style={{ fontSize: 12, width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', color: '#6b6b8a', paddingBottom: 8, paddingRight: 8 }}>#</th>
                  <th style={{ textAlign: 'left', color: '#6b6b8a', paddingBottom: 8 }}>Company</th>
                  <th style={{ textAlign: 'right', color: '#6b6b8a', paddingBottom: 8 }}>Revenue</th>
                  <th style={{ textAlign: 'right', color: '#6b6b8a', paddingBottom: 8 }}>Qty sold</th>
                  <th style={{ textAlign: 'right', color: '#6b6b8a', paddingBottom: 8 }}>Avg price</th>
                </tr>
              </thead>
              <tbody>
                {awardsData.rows.map((row, i) => (
                  <tr key={row.company_id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ color: '#6b6b8a', paddingRight: 10, paddingTop: 4 }}>{i + 1}</td>
                    <td style={{ color: '#c0c0d8', fontWeight: 500, paddingTop: 4 }}>{row.company_name}</td>
                    <td style={{ textAlign: 'right', color: '#fbbf24', fontVariantNumeric: 'tabular-nums', paddingTop: 4 }}>{usdK(row.revenue)}</td>
                    <td style={{ textAlign: 'right', color: '#f87171', fontVariantNumeric: 'tabular-nums', paddingTop: 4 }}>{qty(row.qty_sold)}</td>
                    <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums', paddingTop: 4 }}>{usd(row.avg_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {/* Company activity */}
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '12px 14px' }}>
        <CompanyActivity data={companyActivity} hours={hours} color={item.color} onAwards={openAwards} />
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
  const timerRef       = useRef(null);
  const prevLastPollAt = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.trackerStatus();
      setStatus(s);
      if (s.lastPollAt && prevLastPollAt.current !== null && s.lastPollAt !== prevLastPollAt.current) {
        setRefreshTick((t) => t + 1);
      }
      prevLastPollAt.current = s.lastPollAt ?? prevLastPollAt.current;
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadStatus();
    timerRef.current = setInterval(loadStatus, 5_000);
    return () => clearInterval(timerRef.current);
  }, [loadStatus]);

  const activeItem = ITEMS.find((i) => i.matId === activeTab);

  return (
    <div>
      {/* Compact toolbar: tabs + status + time filters + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 10, borderBottom: '1px solid #1e1e3a' }}>
        {ITEMS.map((item) => (
          <button
            key={item.matId}
            onClick={() => setActiveTab(item.matId)}
            style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer', borderRadius: '5px 5px 0 0',
              background: activeTab === item.matId ? '#13132a' : 'transparent',
              color: activeTab === item.matId ? item.color : '#6b6b8a',
              borderBottom: activeTab === item.matId ? `2px solid ${item.color}` : '2px solid transparent',
            }}
          >
            {item.matName}
          </button>
        ))}

        {status && (
          <span style={{ fontSize: 11, color: '#3a3a55', marginLeft: 8 }}>
            {status.running ? '●' : '○'} {status.pollCount} polls
{status.lastError && <span style={{ color: '#f87171', marginLeft: 6 }}>{status.lastError.item} error</span>}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {HOURS_OPTIONS.map(({ hours: h, label }) => (
          <button
            key={h}
            onClick={() => setHours(h)}
            style={{
              padding: '3px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: 'none',
              background: hours === h ? '#3b3b6a' : 'transparent',
              color: hours === h ? '#e0e0f0' : '#6b6b8a',
            }}
          >
            {label}
          </button>
        ))}
        <button
          className="btn-secondary"
          onClick={() => setRefreshTick((t) => t + 1)}
          style={{ marginLeft: 8, padding: '2px 10px', fontSize: 11 }}
        >
          Refresh
        </button>
      </div>

      {activeItem && (
        <ItemPanel key={`${activeItem.matId}-${hours}`} item={activeItem} hours={hours} refreshTick={refreshTick} />
      )}

      <div style={{ color: '#3a3a55', fontSize: 10, marginTop: 10 }}>
        Snapshots every 60s · Sales only counted when no cheaper orders exist · Green = listed, Red = sold
      </div>
    </div>
  );
}
