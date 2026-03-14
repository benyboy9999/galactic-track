import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fromSlug } from '../utils/slug';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import { api } from '../api';
import Spinner from '../components/Spinner';
import { useAuth } from '../context/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────────────

const ITEM_COLOR = '#a78bfa';

const PAX_THRESHOLDS = [0.1, 0.5, 1, 2, 5];

function gameIncrement(priceCents) {
  if (priceCents <    5_000) return       50;
  if (priceCents <   10_000) return      100;
  if (priceCents <   50_000) return      500;
  if (priceCents <  100_000) return    1_000;
  if (priceCents <  500_000) return    5_000;
  if (priceCents < 1_000_000) return  10_000;
  if (priceCents < 5_000_000) return  50_000;
  return 100_000;
}

const HOURS_OPTIONS = [
  { hours: 24,  label: '24h' },
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
const fmtDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
};

const fmtDayNav = (dateStr) => {
  if (!dateStr) return 'Today';
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
};

function shiftDay(dateStr, delta) {
  const base = dateStr ?? new Date().toISOString().slice(0, 10);
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ── Tooltips ───────────────────────────────────────────────────────────────────

function PriceTooltip({ active, payload, showDate }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#13132a', border: '1px solid #1e1e3a', padding: '8px 12px', fontSize: 12, borderRadius: 6 }}>
      <div style={{ color: '#6b6b8a', marginBottom: 4 }}>{showDate ? fmtDateTime(d.recorded_at) : fmtTime(d.recorded_at)}</div>
      <div>Price: <strong>{usd(d.current_price)}</strong></div>
      <div>Supply: <strong>{qty(d.total_qty_available)}</strong></div>
    </div>
  );
}

function ActivityTooltip({ active, payload, showDate }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#13132a', border: '1px solid #1e1e3a', padding: '8px 12px', fontSize: 12, borderRadius: 6 }}>
      <div style={{ color: '#6b6b8a', marginBottom: 4 }}>{showDate ? fmtDate(d.recorded_at) : fmtTime(d.recorded_at)}</div>
      {Number(d.qty_sold_since_prev) > 0 && <div>Sold: <strong style={{ color: '#f87171' }}>{qty(d.qty_sold_since_prev)}</strong></div>}
      {Number(d.qty_listed_since_prev) > 0 && <div>Listed: <strong style={{ color: '#34d399' }}>{qty(d.qty_listed_since_prev)}</strong></div>}
      {Number(d.flash_qty) > 0 && <div>Flash: <strong style={{ color: '#6b6b8a' }}>{qty(d.flash_qty)}</strong></div>}
    </div>
  );
}

// ── Reusable components ────────────────────────────────────────────────────────


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

function RecentActivity({ events, matName, myCompany }) {
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
              <span style={{ color: myCompany && e.company_name === myCompany ? '#fbbf24' : '#c0c0d8', fontWeight: 500, minWidth: 0 }}>{e.company_name}</span>
              <span style={{ color }}>{text}</span>
              <span style={{ color: '#e0e0f0', fontVariantNumeric: 'tabular-nums' }}>{qty(Number(e.qty))}</span>
              <span style={{ color: '#6b6b8a' }}>{matName}</span>
              <span style={{ color: '#6b6b8a', fontVariantNumeric: 'tabular-nums' }}>@ {usd(e.unit_price)}</span>
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

function CompanyActivity({ data, hours, dayDate, onAwards, myCompany, onCompanyClick }) {
  const [sort,       setSort]       = useState({ key: 'sales_pct', dir: 1 });
  const [hoveredRow, setHoveredRow] = useState(null);
  const [showAll,    setShowAll]    = useState(false);

  if (!data || !data.rows.filter((r) => r.company_name !== 'Federal Reserve').length) {
    return <div style={{ color: '#3a3a55', fontSize: 12 }}>No company activity yet — collecting data.</div>;
  }

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: -1 });
    setShowAll(false);
  }

  const rows = data.rows.filter((r) => r.company_name !== 'Federal Reserve');

  const totalListed  = rows.reduce((s, r) => s + Number(r.current_listed), 0);
  const totalSold    = rows.reduce((s, r) => s + Number(r.qty_sold), 0);
  const prevTotalSold = rows.reduce((s, r) => s + Number(r.prev_qty_sold || 0), 0);
  const hasPrevData  = prevTotalSold > 0;

  const PAGE = 20;

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

  const visible = showAll ? sorted : sorted.slice(0, PAGE);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          Company activity — last {hours}h · click columns to sort · click row for detail
        </div>
        {onAwards && (
          <button onClick={onAwards} style={{
            padding: '1px 8px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
            border: '1px solid #1e1e3a', background: 'transparent', color: '#6b6b8a',
          }}>Awards</button>
        )}
      </div>
      <div className="scroll-x">
      <table style={{ fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: '#3a3a55', width: 24, whiteSpace: 'nowrap' }}>#</th>
            <th style={{ textAlign: 'left', color: '#6b6b8a', whiteSpace: 'nowrap' }}>Company</th>
            {ACTIVITY_COLS.map(({ key, label }) => (
              <th key={key} style={{ ...thStyle(key), whiteSpace: 'nowrap' }} onClick={() => toggleSort(key)}>
                {label}{sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => {
            const isMe      = myCompany && row.company_name === myCompany;
            const isHovered = hoveredRow === row.company_id;
            const bg = isMe      ? 'rgba(251,191,36,0.08)'
                     : isHovered ? 'rgba(255,255,255,0.05)'
                     : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)';
            return (
              <tr
                key={row.company_id}
                style={{ background: bg, cursor: 'pointer' }}
                onMouseEnter={() => setHoveredRow(row.company_id)}
                onMouseLeave={() => setHoveredRow(null)}
                onClick={() => onCompanyClick?.(row)}
              >
                <td style={{ color: '#3a3a55', paddingRight: 6, paddingBottom: 2 }}>{i + 1}</td>
                <td style={{ color: isMe ? '#fbbf24' : '#c0c0d8', fontWeight: 500, paddingBottom: 2 }}>{row.company_name}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', paddingBottom: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    <ShareBar pct={row.sales_pct} color="#f87171" />
                    <span style={{ color: row.sales_pct > 0 ? '#f87171' : '#3a3a55', minWidth: 38 }}>{row.sales_pct > 0 ? `${row.sales_pct}%` : '—'}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'right', color: row.qty_sold > 0 ? '#f87171' : '#3a3a55', fontVariantNumeric: 'tabular-nums', paddingBottom: 2 }}>
                  {row.qty_sold > 0 ? qty(row.qty_sold) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: row.revenue > 0 ? '#fbbf24' : '#3a3a55', fontVariantNumeric: 'tabular-nums', paddingBottom: 2 }}>
                  {row.revenue > 0 ? usdK(row.revenue) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums', paddingBottom: 2 }}>
                  {row.avg_sale_price > 0 ? usd(row.avg_sale_price) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: '#34d399', fontVariantNumeric: 'tabular-nums', paddingBottom: 2 }}>
                  {row.qty_placed > 0 ? `+${qty(row.qty_placed)}` : '—'}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', paddingBottom: 2, color: '#3a3a55' }}>
                  {dayDate ? '—' : <span style={{ color: row.current_listed > 0 ? '#e0e0f0' : '#3a3a55' }}>{qty(row.current_listed)}</span>}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', paddingBottom: 2,
                  color: row.share_delta === null ? '#3a3a55' : row.share_delta > 0 ? '#34d399' : row.share_delta < 0 ? '#f87171' : '#6b6b8a' }}>
                  {row.share_delta === null ? '—' : row.share_delta > 0 ? `+${row.share_delta}%` : `${row.share_delta}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {!showAll && sorted.length > PAGE && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            marginTop: 8, padding: '3px 10px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
            border: '1px solid #1e1e3a', background: 'transparent', color: '#6b6b8a',
          }}
        >
          View {sorted.length - PAGE} more
        </button>
      )}
      <div style={{ fontSize: 10, color: '#3a3a55', marginTop: 8 }}>
        Placed = new listings + restocks · Sold = confirmed fills at lowest price · Cancelled = removed while cheaper orders exist
      </div>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, maxWidth = 640 }) {
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
          padding: '16px 20px', minWidth: 420, maxWidth: maxWidth, maxHeight: '80vh',
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
    b.total_qty_available = row.total_qty_available;
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

function ItemPanel({ item, hours, dayDate, refreshTick, myCompany, onPollCount, intervalMs = 60_000 }) {
  const isMobile = useMediaQuery(639);
  const navigate = useNavigate();
  const [snapshots,       setSnapshots]       = useState([]);
  const [activity,        setActivity]        = useState([]);
  const [companyActivity, setCompanyActivity] = useState(null);
  const [recentEvents,    setRecentEvents]    = useState([]);
  const [orders,          setOrders]          = useState([]);
  const [orderbookView,   setOrderbookView]   = useState('density');
  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]      = useState(false);
  const [error,           setError]           = useState(null);
  // Auto-derived: 15m for 24h/daily views, 1h for 7d/30d rolling
  const [paxThreshold,    setPaxThreshold]    = useState(0.1);
  const [barDetail,       setBarDetail]       = useState(null);
  const [patterns,        setPatterns]        = useState(null);
  const [patternsOpen,      setPatternsOpen]      = useState(false);
  const [awardsOpen,        setAwardsOpen]        = useState(false);
  const [awardsHours,       setAwardsHours]       = useState(24);
  const [awardsData,        setAwardsData]        = useState(null);
  const [awardsLoading,     setAwardsLoading]     = useState(false);
  const activeBarIndex = useRef(null);
  const hasData = snapshots.length > 0;

  const load = useCallback(async () => {
    if (hasData) setRefreshing(true); else setLoading(true);
    const fetchHours = dayDate ? 720 : hours;
    try {
      const [snaps, act, compAct, recent, orderData] = await Promise.all([
        api.trackerSnapshots(item.matId, Math.ceil(fetchHours * 61)),
        api.trackerActivity(item.matId, fetchHours),
        api.trackerCompanyActivity(item.matId, dayDate ? 720 : hours, dayDate),
        api.trackerRecent(item.matId, 10),
        api.trackerOrders(item.matId),
      ]);
      setSnapshots(snaps);
      setActivity(act);
      setCompanyActivity(compAct);
      setRecentEvents(recent);
      setOrders(orderData?.orders ?? []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [item.matId, hours, dayDate, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!onPollCount) return;
    const cutoff = Date.now() - hours * 3_600_000;
    const count = snapshots.filter((s) => new Date(s.recorded_at).getTime() >= cutoff).length;
    onPollCount(count);
  }, [snapshots, hours, onPollCount]);

  if (loading) return <div style={{ padding: 32 }}><Spinner /></div>;
  if (error)   return <div style={{ padding: 16, color: '#f87171', fontSize: 13 }}>{error}</div>;

  // Live values only meaningful in rolling mode (not for a past day)
  const liveLatest = snapshots[snapshots.length - 1];
  const cutoff     = Date.now() - hours * 3_600_000;

  // Auto-select grouping: 15m for 24h/daily views, 1h for 7d/30d
  const priceGroup = (dayDate || hours <= 24) ? '15m' : 'hour';

  // chartSnaps: day-filtered in daily mode, rolling-window-filtered in rolling mode
  const chartSnaps = dayDate
    ? snapshots.filter((s) => s.recorded_at.startsWith(dayDate))
    : snapshots.filter((s) => new Date(s.recorded_at).getTime() >= cutoff);

  // Price/supply change only for rolling mode (live stats, meaningless for past days)
  const oldest = chartSnaps[0];
  const priceChange = !dayDate && liveLatest && oldest && oldest.current_price > 0
    ? ((liveLatest.current_price - oldest.current_price) / oldest.current_price * 100).toFixed(1)
    : null;
  const supplyChange = !dayDate && liveLatest && oldest
    ? Number(liveLatest.total_qty_available) - Number(oldest.total_qty_available)
    : null;

  // displayAct: filtered to selected day in daily mode, full window in rolling mode
  const displayAct  = dayDate
    ? activity.filter((a) => a.recorded_at.startsWith(dayDate))
    : activity;
  const totalSold   = displayAct.reduce((s, r) => s + Number(r.qty_sold_since_prev), 0);
  const totalListed = displayAct.reduce((s, r) => s + Number(r.qty_listed_since_prev), 0);
  const avgSold     = displayAct.length > 0 ? Math.round(totalSold / displayAct.length) : 0;

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

  const qspHourlyRate = !dayDate ? avgSold * 60 : 0; // QSP is live — not meaningful for past days
  let quickSellPrice = null;
  if (qspHourlyRate > 0 && orders.length > 0) {
    const priceMap = new Map();
    for (const o of orders) {
      priceMap.set(Number(o.unit_price), (priceMap.get(Number(o.unit_price)) ?? 0) + Number(o.qty));
    }
    const tiers = [...priceMap.entries()].sort(([a], [b]) => a - b);
    for (const [price, tierQty] of tiers) {
      if (tierQty / qspHourlyRate > 1) {
        quickSellPrice = price - gameIncrement(price);
        break;
      }
    }
  }

  const qspHistory = snapshots
    .slice()
    .reverse()
    .map((s) => s.quick_sell_price)
    .filter((v) => v != null)
    .slice(0, 3);
  let qspArrow = null;
  if (qspHistory.length >= 3) {
    if (qspHistory[0] > qspHistory[1] && qspHistory[1] > qspHistory[2])      qspArrow = { text: '↑', color: '#34d399' };
    else if (qspHistory[0] < qspHistory[1] && qspHistory[1] < qspHistory[2]) qspArrow = { text: '↓', color: '#f87171' };
    else                                                                       qspArrow = { text: '→', color: '#6b6b8a' };
  }

  const statsRows = [
    {
      label: 'Price',
      value: dayDate ? '—' : (liveLatest ? usd(liveLatest.current_price) : '—'),
      delta: priceChange !== null ? `${priceChange > 0 ? '+' : ''}${priceChange}%` : null,
      deltaColor: priceChange > 0 ? '#34d399' : priceChange < 0 ? '#f87171' : undefined,
    },
    {
      label: 'Supply',
      value: dayDate ? '—' : (liveLatest ? qty(liveLatest.total_qty_available) : '—'),
      delta: supplyChange !== null ? `${supplyChange >= 0 ? '+' : ''}${qty(supplyChange)}` : null,
      deltaColor: supplyChange < 0 ? '#f87171' : '#34d399',
    },
    {
      label: `Participants ≥${paxThreshold}%`, onClick: cyclePaxThreshold,
      value: currPax !== null ? String(currPax) : '—',
      delta: paxDelta !== null ? `${paxDelta >= 0 ? '+' : ''}${paxDelta}` : '—',
      deltaColor: paxDelta === null ? '#2a2a45' : paxDelta > 0 ? '#34d399' : paxDelta < 0 ? '#f87171' : '#6b6b8a',
    },
    { label: 'Sold',        value: qty(totalSold),    color: '#f87171' },
    { label: 'Listed',      value: qty(totalListed),  color: '#34d399' },
    { label: 'Sold/hr avg', value: qty(avgSold * 60), color: item.color },
    {
      label: 'Quick Sell Price',
      value: dayDate ? '—' : (quickSellPrice !== null ? usd(quickSellPrice) : '—'),
      color: '#e0e0f0',
      delta: dayDate ? null : (qspArrow ? qspArrow.text : null),
      deltaColor: qspArrow?.color,
    },
  ];

  async function openPatterns() {
    setPatternsOpen(true);
    if (patterns !== null) return;
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

  function openCompany(row) {
    navigate('/company?company=' + encodeURIComponent(row.company_name));
  }

  async function handleBarClick(row) {
    if (!row?.recorded_at) return;
    const from = new Date(row.recorded_at);
    const to   = new Date(from);
    const actGroup = (dayDate || hours <= 24) ? 'hour' : 'day';
    if (actGroup === 'day') to.setDate(to.getDate() + 1);
    else                    to.setHours(to.getHours() + 1);

    if (barDetail?.from === from.toISOString()) { setBarDetail(null); return; }

    setBarDetail({ from: from.toISOString(), to: to.toISOString(), events: null, loading: true });
    try {
      const events = await api.trackerEvents(item.matId, from.toISOString(), to.toISOString());
      setBarDetail((d) => d ? { ...d, events, loading: false } : null);
    } catch {
      setBarDetail((d) => d ? { ...d, events: [], loading: false } : null);
    }
  }

  const snapsLast24h = snapshots.filter(
    (s) => new Date(s.recorded_at).getTime() >= Date.now() - 24 * 3_600_000
  ).length;
  const expectedLast24h = Math.round(24 * 3_600_000 / intervalMs);
  const isNew = snapsLast24h < expectedLast24h * 0.8;

  return (
    <div>
      {refreshing && <div style={{ color: '#3a3a55', fontSize: 11, marginBottom: 6 }}>refreshing…</div>}

      {isNew ? (
        <div style={{
          marginBottom: 10, padding: '7px 12px',
          background: '#1e1440', border: '1px solid #4c1d95', borderRadius: 6,
          color: '#a78bfa', fontSize: 12,
        }}>
          This item was recently added — data will improve over time.
        </div>
      ) : (
        <div style={{
          marginBottom: 10, padding: '7px 12px',
          background: '#1e1440', border: '1px solid #4c1d95', borderRadius: 6,
          color: '#a78bfa', fontSize: 12,
        }}>
          Data is not reliably accurate. All data is inferred and likely to contain errors.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr', gap: 10, marginBottom: 10 }}>

        {/* Column 1: stats + recent activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 12px' }}>
            <SectionLabel>Stats</SectionLabel>
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {statsRows.map(({ label, value, color, delta, deltaColor, onClick }, i) => (
                  <tr key={i}>
                    <td
                      style={{ color: '#6b6b8a', paddingBottom: 3, whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default' }}
                      onClick={onClick}
                      title={onClick ? 'Click to cycle threshold' : undefined}
                    >{label}</td>
                    <td style={{ textAlign: 'right', paddingBottom: 3 }}>
                      <span style={{ color: color ?? '#e0e0f0', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{value}</span>
                      {delta != null && (
                        <span style={{ color: deltaColor ?? '#6b6b8a', fontSize: 10, marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>{delta}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orders.length > 0 && (() => {
            const priceGroups = new Map();
            for (const o of orders) {
              priceGroups.set(o.unit_price, (priceGroups.get(o.unit_price) ?? 0) + Number(o.qty));
            }
            const top5 = [...priceGroups.entries()].sort(([a], [b]) => a - b).slice(0, 5);
            const top5Total = top5.reduce((s, [, q]) => s + q, 0);
            const densityRows = top5.map(([price, cumQty]) => ({
              price, cumQty, pct: top5Total > 0 ? (cumQty / top5Total) * 100 : 0,
            }));

            return (
              <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Live Orderbook</div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {['Company', 'Density'].map((v) => (
                      <button key={v} onClick={() => setOrderbookView(v.toLowerCase())} style={{
                        padding: '1px 7px', fontSize: 10, borderRadius: 3, cursor: 'pointer', border: 'none',
                        background: orderbookView === v.toLowerCase() ? '#3b3b6a' : 'transparent',
                        color:      orderbookView === v.toLowerCase() ? '#e0e0f0' : '#6b6b8a',
                      }}>{v}</button>
                    ))}
                  </div>
                </div>

                {orderbookView === 'company' ? (
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left',  color: '#3a3a55', fontWeight: 400, paddingBottom: 4 }}>Company</th>
                        <th style={{ textAlign: 'right', color: '#3a3a55', fontWeight: 400, paddingBottom: 4 }}>Amount</th>
                        <th style={{ textAlign: 'right', color: '#3a3a55', fontWeight: 400, paddingBottom: 4 }}>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.slice(0, 5).map((o, i) => {
                        const isMe = myCompany && o.company_name === myCompany;
                        return (
                          <tr key={o.order_id ?? i} style={{ background: isMe ? 'rgba(251,191,36,0.08)' : undefined }}>
                            <td style={{ color: isMe ? '#fbbf24' : '#c0c0d8', paddingBottom: 3, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.company_name}>{o.company_name}</td>
                            <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums', paddingBottom: 3 }}>{qty(o.qty)}</td>
                            <td style={{ textAlign: 'right', color: isMe ? '#fbbf24' : '#e0e0f0', fontVariantNumeric: 'tabular-nums', fontWeight: 600, paddingBottom: 3 }}>{usd(o.unit_price)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left',  color: '#3a3a55', fontWeight: 400, paddingBottom: 4 }}>Volume</th>
                        <th style={{ textAlign: 'right', color: '#3a3a55', fontWeight: 400, paddingBottom: 4 }}>Amount</th>
                        <th style={{ textAlign: 'right', color: '#3a3a55', fontWeight: 400, paddingBottom: 4 }}>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {densityRows.map(({ price, cumQty, pct }) => (
                        <tr key={price}>
                          <td style={{ paddingBottom: 4, paddingRight: 8 }}>
                            <div style={{ flex: 1, height: 10, background: '#1e1e3a', borderRadius: 1, overflow: 'hidden', minWidth: 60 }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: item.color, borderRadius: 1, opacity: 0.8 }} />
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums', paddingBottom: 4 }}>{qty(cumQty)}</td>
                          <td style={{ textAlign: 'right', color: '#e0e0f0', fontVariantNumeric: 'tabular-nums', fontWeight: 600, paddingBottom: 4 }}>{usd(price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 12px', flex: 1 }}>
            <RecentActivity events={recentEvents} matName={item.matName} myCompany={myCompany} />
          </div>
        </div>

        {/* Column 2: charts stacked */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 10px 4px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: isMobile ? 220 : 0 }}>
            <div style={{ marginBottom: 10 }}>
              <SectionLabel>Price · last snapshot {fmtTime(liveLatest?.recorded_at)}</SectionLabel>
            </div>
            {chartSnaps.length > 1 ? (
              <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={groupSnapshots(chartSnaps, priceGroup)}>
                    <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                    <XAxis dataKey="recorded_at"
                      tickFormatter={hours > 24 && !dayDate ? fmtDate : fmtTime}
                      tick={{ fontSize: 10, fill: '#6b6b8a' }}
                      interval="preserveStartEnd" />
                    <YAxis yAxisId="price" tickFormatter={(v) => usd(v)} tick={{ fontSize: 10, fill: '#6b6b8a' }} width={58}
                      domain={[
                        (min) => Math.round(min * 0.95),
                        (max) => Math.round(max * 1.05),
                      ]} />
                    <YAxis yAxisId="supply" orientation="right" tickFormatter={qty} tick={{ fontSize: 10, fill: '#3a3a55' }} width={44} />
                    <Tooltip content={<PriceTooltip showDate={hours > 24 && !dayDate} />} cursor={{ stroke: 'rgba(59, 59, 106, 0.8)', strokeWidth: 1, fill: 'rgba(59, 59, 106, 0.15)' }} />
                    <Line yAxisId="price"  type="monotone" dataKey="current_price"       stroke={item.color} dot={false} strokeWidth={2} />
                    <Line yAxisId="supply" type="monotone" dataKey="total_qty_available" stroke="#3a3a55"    dot={false} strokeWidth={1} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: '#3a3a55', fontSize: 12, padding: 20 }}>Collecting data…</div>
            )}
          </div>
          <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 10px 4px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: isMobile ? 220 : 0 }}>
            {(() => {
              const actGroup = (dayDate || hours <= 24) ? 'hour' : 'day';
              const grouped  = groupActivity(displayAct, actGroup);
              const tickFmt     = actGroup === 'day'
                ? (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
                : fmtTime;
              const hasActivity = grouped.some((a) => Number(a.qty_sold_since_prev) > 0 || Number(a.qty_listed_since_prev) > 0);
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {dayDate ? `Sold vs listed · ${new Date(dayDate + 'T00:00:00Z').toLocaleDateString([], { day: 'numeric', month: 'short' })}` : `Sold vs listed · last ${hours <= 24 ? '24h' : hours <= 168 ? '7d' : '30d'}`}
                    </div>
                    <button onClick={openPatterns} style={{
                      padding: '1px 6px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                      border: '1px solid #1e1e3a', background: 'transparent', color: '#6b6b8a',
                    }}>Patterns</button>
                  </div>
                  {dayDate && !hasActivity ? (
                    <div style={{ color: '#3a3a55', fontSize: 12, padding: 20 }}>No data for this date — try a wider rolling window first.</div>
                  ) : hasActivity ? (
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
                          <XAxis dataKey="recorded_at" tickFormatter={tickFmt} tick={{ fontSize: 10, fill: '#6b6b8a' }} interval="preserveStartEnd" />
                          <YAxis tickFormatter={qty} tick={{ fontSize: 10, fill: '#6b6b8a' }} width={44} />
                          <Tooltip content={<ActivityTooltip showDate={actGroup === 'day'} />} cursor={{ fill: 'rgba(59, 59, 106, 0.35)' }} />
                          <Bar dataKey="qty_listed_since_prev" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} stackId="a" />
                          <Bar dataKey="qty_sold_since_prev"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} stackId="b" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div style={{ color: '#3a3a55', fontSize: 12, padding: 20 }}>Need ≥2 snapshots with activity.</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Patterns modal */}
      {patternsOpen && (
        <Modal title={`Activity patterns · ${item.matName}`} onClose={() => setPatternsOpen(false)}>
          {!patterns ? (
            <Spinner />
          ) : patterns.byHour.length === 0 ? (
            <div style={{ color: '#3a3a55', fontSize: 12 }}>No data yet — patterns will populate as snapshots accumulate.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <span style={{ fontSize: 11, color: '#6b6b8a' }}>
                Average per period · based on {patterns.daysTracked} day{patterns.daysTracked !== 1 ? 's' : ''} of data
              </span>
              <div>
                <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Avg activity · by hour of day</div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={patterns.byHour} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#6b6b8a' }} interval={1} />
                      <YAxis tickFormatter={qty} tick={{ fontSize: 9, fill: '#6b6b8a' }} width={40} />
                      <Tooltip cursor={{ fill: 'rgba(59,59,106,0.35)' }} contentStyle={{ background: '#13132a', border: '1px solid #1e1e3a', fontSize: 11 }} />
                      <Bar dataKey="avg_qty_listed" name="Listed" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} stackId="a" />
                      <Bar dataKey="avg_qty_sold"   name="Sold"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} stackId="b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Avg activity · by day of week</div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={patterns.byDow} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b6b8a' }} />
                      <YAxis tickFormatter={qty} tick={{ fontSize: 9, fill: '#6b6b8a' }} width={40} />
                      <Tooltip cursor={{ fill: 'rgba(59,59,106,0.35)' }} contentStyle={{ background: '#13132a', border: '1px solid #1e1e3a', fontSize: 11 }} />
                      <Bar dataKey="avg_qty_listed" name="Listed" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} stackId="a" />
                      <Bar dataKey="avg_qty_sold"   name="Sold"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} stackId="b" />
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
          title={`Transactions · ${new Date(barDetail.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(barDetail.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${item.matName}`}
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
                const isMe = myCompany && e.company_name === myCompany;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
                    <span style={{ color: isMe ? '#fbbf24' : '#c0c0d8', fontWeight: 500 }}>{e.company_name}</span>
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
                {awardsData.rows.map((row, i) => {
                  const isMe = myCompany && row.company_name === myCompany;
                  return (
                    <tr key={row.company_id} style={{ background: isMe ? 'rgba(251,191,36,0.08)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                      <td style={{ color: '#6b6b8a', paddingRight: 10, paddingTop: 4 }}>{i + 1}</td>
                      <td style={{ color: isMe ? '#fbbf24' : '#c0c0d8', fontWeight: 500, paddingTop: 4 }}>{row.company_name}</td>
                      <td style={{ textAlign: 'right', color: '#fbbf24', fontVariantNumeric: 'tabular-nums', paddingTop: 4 }}>{usdK(row.revenue)}</td>
                      <td style={{ textAlign: 'right', color: '#f87171', fontVariantNumeric: 'tabular-nums', paddingTop: 4 }}>{qty(row.qty_sold)}</td>
                      <td style={{ textAlign: 'right', color: '#6b6b8a', fontVariantNumeric: 'tabular-nums', paddingTop: 4 }}>{usd(row.avg_price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {/* Company activity */}
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '12px 14px' }}>
        <CompanyActivity data={companyActivity} hours={hours} dayDate={dayDate} onAwards={openAwards} myCompany={myCompany} onCompanyClick={openCompany} />
      </div>

    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ItemDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const myCompany = user?.companyName ?? '';

  const [item,        setItem]        = useState(null);
  const [itemLoading, setItemLoading] = useState(true);
  const [hours,    setHours]    = useState(24);
  const [viewMode, setViewMode] = useState('rolling'); // 'rolling' | 'daily'
  const [dayDate,  setDayDate]  = useState(null);      // 'YYYY-MM-DD' or null
  const [status,      setStatus]      = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pollsInWindow, setPollsInWindow] = useState(null);
  const [tracking,    setTracking]    = useState(false);
  const [trackErr,    setTrackErr]    = useState('');
  const [alertsOpen,   setAlertsOpen]   = useState(false);
  const [alerts,       setAlerts]       = useState([]);
  const [alertPrice,   setAlertPrice]   = useState('');
  const [alertErr,     setAlertErr]     = useState('');
  const [alertWorking, setAlertWorking] = useState(false);
  const timerRef       = useRef(null);
  const prevLastPollAt = useRef(null);
  const alertsRef      = useRef(null);

  const loadItem = useCallback(async () => {
    try {
      const items = await api.allItems();
      setItem(fromSlug(slug, items));
    } catch { /* ignore */ } finally {
      setItemLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadItem(); }, [loadItem]);

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
    if (!item?.tracked) return;
    loadStatus();
    timerRef.current = setInterval(loadStatus, 5_000);
    return () => clearInterval(timerRef.current);
  }, [loadStatus, item?.tracked]);

  // ── Price alerts ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!alertsOpen) return;
    function handle(e) { if (alertsRef.current && !alertsRef.current.contains(e.target)) setAlertsOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [alertsOpen]);

  function openAlerts() {
    setAlertsOpen((v) => !v);
    if (!alertsOpen && user) api.getAlerts().then(setAlerts).catch(() => {});
  }

  async function submitAlert(e) {
    e.preventDefault();
    setAlertErr('');
    const targetPrice = Math.round(parseFloat(alertPrice) * 100);
    if (isNaN(targetPrice) || targetPrice <= 0) { setAlertErr('Enter a valid price'); return; }
    setAlertWorking(true);
    try {
      const created = await api.createAlert(item.matId, targetPrice);
      setAlerts((prev) => [created, ...prev]);
      setAlertPrice('');
    } catch (err) {
      setAlertErr(err.message);
    } finally {
      setAlertWorking(false);
    }
  }

  async function deleteAlert(id) {
    await api.deleteAlert(id).catch(() => {});
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleTrack() {
    setTracking(true);
    setTrackErr('');
    try {
      await api.trackItem(item.matId);
      await Promise.all([loadItem(), refreshUser()]);
    } catch (e) {
      setTrackErr(e.message);
    } finally {
      setTracking(false);
    }
  }

  const hasCredits = (user?.creditsUsed ?? 0) < (user?.creditsTotal ?? 3);

  if (itemLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner /></div>;
  if (!item)       return <div style={{ padding: 40, color: '#f87171' }}>Item not found.</div>;

  const panelItem = { matId: item.matId, matName: item.matName, color: ITEM_COLOR };

  return (
    <div>
      {/* Header toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, borderBottom: '1px solid #1e1e3a', paddingBottom: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 12, padding: '3px 0', flexShrink: 0 }}
        >
          ← Items
        </button>
        <div style={{ width: 1, height: 14, background: '#1e1e3a', flexShrink: 0 }} />
        <span style={{ color: '#e0e0ff', fontWeight: 600, fontSize: 14 }}>{item.matName}</span>

        <div style={{ flex: 1 }} />

        {/* Unified time controls (only when tracked) */}
        {item.tracked && (
          <>
            {/* Rolling / Daily pill toggle */}
            <div style={{ display: 'flex', background: '#13132a', border: '1px solid #1e1e3a', borderRadius: 6, padding: 2 }}>
              {[['rolling', 'Live'], ['daily', 'Historical']].map(([mode, label]) => (
                <button key={mode} onClick={() => {
                  setViewMode(mode);
                  if (mode === 'daily') setDayDate((d) => d ?? new Date().toISOString().slice(0, 10));
                  if (mode === 'rolling') setDayDate(null);
                }} style={{
                  padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
                  background: viewMode === mode ? '#1e1440' : 'transparent',
                  color: viewMode === mode ? '#a78bfa' : '#6b6b8a',
                  fontWeight: viewMode === mode ? 600 : 400,
                }}>{label}</button>
              ))}
            </div>
            {/* Period buttons or date navigation */}
            {viewMode === 'rolling' ? (
              <div style={{ display: 'flex', gap: 4 }}>
                {HOURS_OPTIONS.map((o) => (
                  <button key={o.hours} onClick={() => setHours(o.hours)} style={{
                    background: hours === o.hours ? '#1e1440' : 'none',
                    border: `1px solid ${hours === o.hours ? '#4c1d95' : '#2e2e5a'}`,
                    borderRadius: 6, padding: '4px 10px',
                    color: hours === o.hours ? '#a78bfa' : '#6b6b8a',
                    fontSize: 11, fontWeight: hours === o.hours ? 600 : 400, cursor: 'pointer',
                  }}>{o.label}</button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setDayDate((d) => shiftDay(d, -1))} style={{
                  padding: '4px 10px', borderRadius: 5, border: '1px solid #2e2e5a', background: 'none',
                  color: '#6b6b8a', cursor: 'pointer', fontSize: 14, lineHeight: 1,
                }}>‹</button>
                <span style={{ color: '#e0e0f0', fontSize: 12, minWidth: 100, textAlign: 'center' }}>
                  {fmtDayNav(dayDate)}
                </span>
                <button
                  onClick={() => { const next = shiftDay(dayDate, 1); if (next <= new Date().toISOString().slice(0, 10)) setDayDate(next); }}
                  disabled={!dayDate || dayDate >= new Date().toISOString().slice(0, 10)}
                  style={{
                    padding: '4px 10px', borderRadius: 5, border: '1px solid #2e2e5a', background: 'none',
                    color: (!dayDate || dayDate >= new Date().toISOString().slice(0, 10)) ? '#3a3a55' : '#6b6b8a',
                    cursor: (!dayDate || dayDate >= new Date().toISOString().slice(0, 10)) ? 'default' : 'pointer',
                    fontSize: 14, lineHeight: 1,
                  }}>›</button>
              </div>
            )}
          </>
        )}

        {/* Poll status */}
        {status && item.tracked && (() => {
          const expected = status.intervalMs
            ? Math.round(hours * 3_600_000 / status.intervalMs)
            : null;
          const pct = expected && pollsInWindow != null
            ? Math.round(pollsInWindow / expected * 100)
            : null;
          const pctColor = pct == null ? '#3a3a55' : pct >= 80 ? '#10b981' : pct >= 50 ? '#fbbf24' : '#f87171';
          return (
            <span style={{ fontSize: 11, color: '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
              {status.running ? '●' : '○'}{' '}
              <span style={{ color: pctColor }}>
                {pollsInWindow ?? '—'}{expected != null ? ` / ${expected}` : ''} polls
                {pct != null && <span style={{ marginLeft: 4 }}>({pct}%)</span>}
              </span>
              {status.lastError && <span style={{ color: '#f87171', marginLeft: 6 }}>error</span>}
            </span>
          );
        })()}

        {item.tracked && (
          <button
            onClick={() => setRefreshTick((t) => t + 1)}
            style={{ padding: '2px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #2e2e5a', background: 'transparent', color: '#6b6b8a' }}
          >
            Refresh
          </button>
        )}

        {/* Price alerts button + dropdown */}
        {item.tracked && user && (
          <div ref={alertsRef} style={{ position: 'relative' }}>
            {(() => {
              const itemAlerts = alerts.filter((a) => a.mat_id === item.matId);
              return (
                <>
                  <button
                    onClick={openAlerts}
                    style={{
                      background: alertsOpen ? '#1e1440' : 'none',
                      border: `1px solid ${alertsOpen ? '#7c3aed' : '#2e2e5a'}`,
                      borderRadius: 6, padding: '2px 10px',
                      color: alertsOpen ? '#a78bfa' : '#6b6b8a',
                      fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    🔔{itemAlerts.length > 0 ? ` (${itemAlerts.length})` : ''}
                  </button>

                  {alertsOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                      background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 10,
                      width: 'min(300px, 90vw)', zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      padding: '14px 16px',
                    }}>
                      <div style={{ fontSize: 11, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
                        Price Alerts
                      </div>

                      {itemAlerts.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#3a3a55', marginBottom: 14 }}>No alerts set for this item.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                          {itemAlerts.map((a) => (
                            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: '#0f0f28', borderRadius: 6 }}>
                              <span style={{ flex: 1, fontSize: 12, color: '#c0c0d8' }}>{a.mat_name}</span>
                              <span style={{ fontSize: 11, color: a.direction === 'up' ? '#34d399' : '#f87171', flexShrink: 0 }}>
                                {a.direction === 'up' ? '↑' : '↓'} ${(a.target_price / 100).toFixed(2)}
                              </span>
                              <button
                                onClick={() => deleteAlert(a.id)}
                                style={{ background: 'none', border: 'none', color: '#3a3a55', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                                title="Remove alert"
                              >✕</button>
                            </div>
                          ))}
                        </div>
                      )}

                      <form onSubmit={submitAlert} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 11, color: '#4a4a6a', marginBottom: 2 }}>Notify me when price reaches — direction inferred automatically</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="Target price ($)"
                            value={alertPrice}
                            onChange={(e) => setAlertPrice(e.target.value)}
                            className="search-input"
                            style={{ marginBottom: 0, flex: 1, fontSize: 12 }}
                            required
                          />
                          <button
                            type="submit"
                            disabled={alertWorking}
                            style={{
                              background: '#1e1440', border: '1px solid #7c3aed', borderRadius: 6,
                              color: '#a78bfa', fontSize: 12, padding: '0 12px', cursor: 'pointer', flexShrink: 0,
                            }}
                          >
                            {alertWorking ? '…' : 'Set'}
                          </button>
                        </div>
                        {alertErr && <div style={{ fontSize: 11, color: '#f87171' }}>{alertErr}</div>}
                      </form>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Untracked state */}
      {!item.tracked && (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <p style={{ color: '#4a4a6a', fontSize: 14, marginBottom: 4 }}>
            Nobody is tracking {item.matName} yet.
          </p>
          <p style={{ color: '#3a3a55', fontSize: 12, marginBottom: 28 }}>
            Tracking starts collecting market data every 60 seconds, visible to everyone on the platform.
          </p>
          {hasCredits ? (
            <>
              {trackErr && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{trackErr}</p>}
              <button
                onClick={handleTrack}
                disabled={tracking}
                style={{
                  background: '#1e0a3a', border: '1px solid #4c1d95', borderRadius: 6,
                  padding: '10px 28px', color: '#a78bfa', fontSize: 14,
                  cursor: tracking ? 'not-allowed' : 'pointer', opacity: tracking ? 0.6 : 1,
                }}
              >
                {tracking ? 'Starting…' : 'Start tracking'}
              </button>
              <p style={{ color: '#3a3a55', fontSize: 11, marginTop: 16, lineHeight: 1.6 }}>
                Data populates gradually — expect up to 24 hours before charts and company activity are fully representative.
              </p>
            </>
          ) : (
            <div style={{ maxWidth: 320, margin: '0 auto' }}>
              <p style={{ color: '#6b6b8a', fontSize: 13, marginBottom: 12 }}>
                You're already tracking your full allocation of items.
              </p>
              <p style={{ color: '#4a4a6a', fontSize: 12, lineHeight: 1.7 }}>
                Want this item tracked? Share the platform with a friend — each new member can track up to 3 items, adding data for everyone.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tracked — full panel */}
      {item.tracked && (
        <ItemPanel
          key={`${item.matId}-${hours}`}
          item={panelItem}
          hours={hours}
          dayDate={dayDate}
          refreshTick={refreshTick}
          myCompany={myCompany}
          onPollCount={setPollsInWindow}
          intervalMs={status?.intervalMs ?? 60_000}
        />
      )}

    </div>
  );
}
