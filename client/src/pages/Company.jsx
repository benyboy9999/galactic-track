import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import Spinner from '../components/Spinner';
import { toIconId } from '../utils/materialIcon';
import { toSlug } from '../utils/slug';

const SPRITE_URL = '/api/gamedata/sprite';

// ── Company logo ─────────────────────────────────────────────────────────────

const LOGO_PALETTE = [
  '#db1a1a', '#c34b22', '#f68055', '#f2740d', '#f2ad0d',
  '#e4e40c', '#99da0b', '#0ac20a', '#10c16e', '#0bd0d0',
  '#93ceec', '#0da6f2', '#256af4', '#734dff', '#b399e6',
  '#9933ff', '#dd3cdd', '#eb477e', '#f0a8c0', '#cccccc',
];

function decodeCompanyLogo(ic) {
  try {
    const normalized = ic.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length !== 8) return null;
    const pixels = Array.from({ length: 7 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => {
        const i = r * 7 + c;
        return ((bytes[Math.floor(i / 8)] >> (i % 8)) & 1) === 1;
      })
    );
    const colorCode = bytes[6] & 0x3f;
    const swatchIndex = Math.max(0, Math.min(LOGO_PALETTE.length - 1, colorCode >> 1));
    return { pixels, color: LOGO_PALETTE[swatchIndex] };
  } catch { return null; }
}

function CompanyLogo({ ic, size = 40 }) {
  const logo = useMemo(() => ic ? decodeCompanyLogo(ic) : null, [ic]);
  if (!logo) return null;
  const px = size / 7;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <rect width={size} height={size} fill="#0a0a18" rx={4} />
      {logo.pixels.map((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill={logo.color} /> : null
        )
      )}
    </svg>
  );
}

// ── Formatters ───────────────────────────────────────────────────────────────

const usd = (v) => {
  if (!v) return '—';
  const d = v / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(2)}`;
};

const usdFull = (v) => v > 0 ? `$${(v / 100).toFixed(2)}` : '—';

const qty = (v) => {
  if (v == null || v === 0) return '—';
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
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// ── Time range options ───────────────────────────────────────────────────────

const TABLE_HOURS_OPTIONS = [
  { hours: 24,  label: '24h' },
  { hours: 168, label: '7d'  },
  { hours: 720, label: '30d' },
];

const CHART_RES_OPTIONS = [
  { secs: 900,  label: '15m' },
  { secs: 3600, label: '1h'  },
];

// ── Event labels ─────────────────────────────────────────────────────────────

const EVENT_LABEL = {
  new_listing:  { text: 'listed',    color: '#34d399' },
  restocked:    { text: 'restocked', color: '#34d399' },
  partial_fill: { text: 'sold',      color: '#f87171' },
  full_fill:    { text: 'sold',      color: '#f87171' },
  cancelled:    { text: 'cancelled', color: '#6b6b8a' },
};

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 10, padding: '16px 20px', minWidth: 420, maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
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

// ── Shared primitives ────────────────────────────────────────────────────────

function ShareBar({ pct }) {
  return (
    <div style={{ width: 60, height: 4, background: '#1e1e3a', borderRadius: 3, overflow: 'hidden', display: 'inline-block', verticalAlign: 'middle', marginLeft: 6 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: '#a78bfa' }} />
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

function MatIcon({ name, size = 16 }) {
  if (!name) return null;
  return (
    <svg width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <use href={`${SPRITE_URL}#${toIconId(name)}`} width={size} height={size} />
    </svg>
  );
}

// ── Dev company search ───────────────────────────────────────────────────────

function CompanySearchBar({ onSelect }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef     = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await api.companySearch(query);
        setResults(rows);
        setOpen(rows.length > 0);
      } catch { setResults([]); setOpen(false); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSelect(row) {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(row.company_id, row.company_name);
  }

  function handleClear() {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(null, null);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 240 }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="View any company…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#13132a', border: '1px solid #2e2e5a',
            borderRadius: 6, padding: '5px 26px 5px 10px',
            color: '#e0e0ff', fontSize: 12,
          }}
        />
        <span style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          color: '#3a3a55', fontSize: 11, cursor: query ? 'pointer' : 'default',
        }} onClick={query ? handleClear : undefined}>
          {loading ? '…' : query ? '✕' : ''}
        </span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          {results.map((row) => (
            <button
              key={row.company_id}
              onMouseDown={() => handleSelect(row)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', padding: '7px 12px', background: 'none',
                border: 'none', borderBottom: '1px solid #13132a',
                color: '#9090b0', fontSize: 12, cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#0f0f28'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              <span style={{ color: '#c0c0d8' }}>{row.company_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, hours }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const fmt = hours > 24 ? fmtDate : fmtTime;
  return (
    <div style={{ background: '#13132a', border: '1px solid #1e1e3a', padding: '8px 12px', fontSize: 12, borderRadius: 6 }}>
      <div style={{ color: '#6b6b8a', marginBottom: 4 }}>{fmt(d.recorded_at)}</div>
      {d.qty_sold   > 0 && <div>Sold: <strong style={{ color: '#f87171' }}>{qty(d.qty_sold)}</strong></div>}
      {d.qty_listed > 0 && <div>Listed: <strong style={{ color: '#34d399' }}>{qty(d.qty_listed)}</strong></div>}
    </div>
  );
}

// ── Bucket fill ──────────────────────────────────────────────────────────────

function fillBuckets(data, chartRes, hours = 24) {
  const nowSecs   = Math.floor(Date.now() / 1000);
  const startSecs = Math.floor((nowSecs - hours * 3600) / chartRes) * chartRes;
  const dataMap   = new Map(
    data.map((d) => [Math.floor(new Date(d.recorded_at).getTime() / 1000 / chartRes) * chartRes, d])
  );
  const result = [];
  for (let t = startSecs; t <= nowSecs; t += chartRes) {
    result.push(dataMap.get(t) ?? { recorded_at: new Date(t * 1000).toISOString(), qty_sold: 0, qty_listed: 0 });
  }
  return result;
}

// ── Activity chart ───────────────────────────────────────────────────────────

function ActivityChart({ viewId, companyName }) {
  const [chartRes,  setChartRes]  = useState(3600);
  const [timeline,  setTimeline]  = useState([]);
  const [barDetail, setBarDetail] = useState(null); // { from, to, events, loading }
  const activeBarIndex = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.companyTimeline(24, viewId, chartRes)
      .then((rows) => { if (!cancelled) setTimeline(fillBuckets(rows, chartRes)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [viewId, chartRes]);

  const handleBarClick = useCallback(async (row) => {
    if (!row?.recorded_at) return;
    const from = new Date(row.recorded_at);
    const to   = new Date(from.getTime() + chartRes * 1000);

    // Toggle off if same bar clicked again
    if (barDetail?.from === from.toISOString()) { setBarDetail(null); return; }

    setBarDetail({ from: from.toISOString(), to: to.toISOString(), events: null, loading: true });
    try {
      const events = await api.companyEvents(viewId, 200, from.toISOString(), to.toISOString());
      setBarDetail((d) => d ? { ...d, events, loading: false } : null);
    } catch {
      setBarDetail((d) => d ? { ...d, events: [], loading: false } : null);
    }
  }, [viewId, chartRes, barDetail]);

  const hasData = timeline.some((b) => b.qty_sold > 0 || b.qty_listed > 0);

  const modalTitle = barDetail
    ? `Activity · ${fmtTime(barDetail.from)} – ${fmtTime(barDetail.to)}`
    : '';

  return (
    <>
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '12px 14px', height: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <SectionLabel>Sold vs listed — last 24h</SectionLabel>
          <div style={{ display: 'flex', gap: 2 }}>
            {CHART_RES_OPTIONS.map((o) => (
              <button key={o.secs} onClick={() => { setChartRes(o.secs); setBarDetail(null); }} style={{
                padding: '1px 6px', fontSize: 10, borderRadius: 3, cursor: 'pointer', border: 'none',
                background: chartRes === o.secs ? '#3b3b6a' : 'transparent',
                color: chartRes === o.secs ? '#e0e0f0' : '#6b6b8a',
              }}>{o.label}</button>
            ))}
          </div>
        </div>
        {!hasData ? (
          <div style={{ color: '#3a3a55', fontSize: 12 }}>No activity in the last 24h.</div>
        ) : (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={timeline}
                margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
                style={{ cursor: 'pointer' }}
                onMouseMove={(s) => { activeBarIndex.current = s?.activeTooltipIndex ?? null; }}
                onMouseLeave={() => { activeBarIndex.current = null; }}
                onClick={() => { if (activeBarIndex.current != null) handleBarClick(timeline[activeBarIndex.current]); }}
              >
                <CartesianGrid stroke="#1e1e3a" strokeDasharray="3 3" />
                <XAxis dataKey="recorded_at" tickFormatter={fmtTime} tick={{ fontSize: 10, fill: '#6b6b8a' }} interval="preserveStartEnd" />
                <YAxis tickFormatter={qty} tick={{ fontSize: 10, fill: '#6b6b8a' }} width={44} />
                <Tooltip content={<ChartTooltip hours={24} />} cursor={{ fill: 'rgba(59,59,106,0.35)' }} />
                <Bar dataKey="qty_listed" name="Listed" fill="#34d399" opacity={0.6} radius={[2, 2, 0, 0]} />
                <Bar dataKey="qty_sold"   name="Sold"   fill="#f87171" opacity={0.85} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {barDetail && (
        <Modal title={modalTitle} onClose={() => setBarDetail(null)}>
          {barDetail.loading ? (
            <Spinner />
          ) : !barDetail.events?.length ? (
            <div style={{ color: '#3a3a55', fontSize: 12 }}>No events in this window.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {barDetail.events.map((e, i) => {
                const { text, color } = EVENT_LABEL[e.eventType] ?? { text: e.eventType, color: '#6b6b8a' };
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
                    <span style={{ color: '#c0c0d8', fontWeight: 500 }}>{companyName}</span>
                    <span style={{ color }}>{text}</span>
                    <span style={{ color: '#e0e0f0', fontVariantNumeric: 'tabular-nums' }}>{qty(Math.abs(e.qtyChange))}</span>
                    <span style={{ color: '#6b6b8a' }}>{e.matName}</span>
                    {e.unitPrice > 0 && <span style={{ color: '#6b6b8a', fontVariantNumeric: 'tabular-nums' }}>@ {usdFull(e.unitPrice)}</span>}
                    <span style={{ color: '#3a3a55', fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtTime(e.recordedAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

// ── Activity feed ────────────────────────────────────────────────────────────

function ActivityFeed({ events, companyName }) {
  return (
    <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '12px 14px' }}>
      <SectionLabel>Recent activity</SectionLabel>
      {!events || events.length === 0 ? (
        <div style={{ color: '#3a3a55', fontSize: 12 }}>No events yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {events.map((e, i) => {
            const { text, color } = EVENT_LABEL[e.eventType] ?? { text: e.eventType, color: '#6b6b8a' };
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
                <span style={{ color: '#c0c0d8', fontWeight: 500 }}>{companyName}</span>
                <span style={{ color }}>{text}</span>
                <span style={{ color: '#e0e0f0', fontVariantNumeric: 'tabular-nums' }}>{qty(Math.abs(e.qtyChange))}</span>
                <span style={{ color: '#6b6b8a' }}>{e.matName}</span>
                {e.unitPrice > 0 && (
                  <span style={{ color: '#6b6b8a', fontVariantNumeric: 'tabular-nums' }}>@ {usdFull(e.unitPrice)}</span>
                )}
                <span style={{ color: '#3a3a55', fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{timeAgo(e.recordedAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Per-item table ───────────────────────────────────────────────────────────

function GrowthBadge({ delta }) {
  if (delta == null || delta === 0) return <span style={{ color: '#3a3a55' }}>—</span>;
  const up = delta > 0;
  return (
    <span style={{ color: up ? '#34d399' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function ItemsTable({ items, labelHours }) {
  const headers = ['Item', 'Rank', 'Sales %', 'Sold', 'Revenue', 'Avg Price', 'Placed', 'Supply Now', 'Growth'];

  return (
    <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px 4px', borderBottom: '1px solid #1e1e3a' }}>
        <SectionLabel>Items — last {labelHours}</SectionLabel>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1e1e3a' }}>
            {headers.map((h) => (
              <th key={h} style={{
                padding: '8px 14px', textAlign: h === 'Item' ? 'left' : 'right',
                color: '#6b6b8a', fontSize: 10, fontWeight: 500,
                textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr
              key={item.matId}
              style={{ borderBottom: i < items.length - 1 ? '1px solid #13132a' : 'none', transition: 'background 0.1s' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#0f0f28'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <td style={{ padding: '10px 14px' }}>
                <a href={item.matName ? `/${toSlug(item.matName)}` : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}>
                  <MatIcon name={item.matName} size={16} />
                  <span style={{ color: '#e0e0f0', fontWeight: 500 }}>{item.matName ?? `Item #${item.matId}`}</span>
                </a>
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {item.rank != null
                  ? <span style={{ color: item.rank <= 3 ? '#fbbf24' : '#9090b0' }}>#{item.rank}</span>
                  : <span style={{ color: '#3a3a55' }}>—</span>}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <span style={{ color: item.salesPct > 0 ? '#a78bfa' : '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
                    {item.salesPct > 0 ? `${item.salesPct.toFixed(1)}%` : '—'}
                  </span>
                  {item.salesPct > 0 && <ShareBar pct={item.salesPct} />}
                </div>
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: item.qtySold > 0 ? '#34d399' : '#3a3a55', fontVariantNumeric: 'tabular-nums', fontWeight: item.qtySold > 0 ? 600 : 400 }}>
                {qty(item.qtySold)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: item.revenue > 0 ? '#a78bfa' : '#3a3a55', fontVariantNumeric: 'tabular-nums', fontWeight: item.revenue > 0 ? 600 : 400 }}>
                {usd(item.revenue)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#9090b0', fontVariantNumeric: 'tabular-nums' }}>
                {item.avgPrice != null ? usdFull(item.avgPrice) : '—'}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: item.qtyPlaced > 0 ? '#e0e0f0' : '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
                {qty(item.qtyPlaced)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: item.currentListed > 0 ? '#60a5fa' : '#3a3a55', fontVariantNumeric: 'tabular-nums' }}>
                {qty(item.currentListed)}
              </td>
              <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                <GrowthBadge delta={item.shareDelta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Company() {
  const [searchParams] = useSearchParams();
  const [hours,   setHours]   = useState(24);
  const [data,     setData]     = useState(null);
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState('');
  const [viewId,   setViewId]   = useState(null);
  const [viewName, setViewName] = useState(null);

  // Resolve company name from URL param on mount
  useEffect(() => {
    const nameParam = searchParams.get('company');
    if (!nameParam) return;
    api.companySearch(nameParam).then((results) => {
      const match = results.find((r) => r.company_name === nameParam);
      if (match) { setViewId(match.company_id); setViewName(match.company_name); }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load summary (table)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    api.companySummary(hours, viewId)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [hours, viewId]);

  // Load activity feed (always latest 20, not time-range dependent)
  useEffect(() => {
    let cancelled = false;
    api.companyEvents(viewId, 10)
      .then((rows) => { if (!cancelled) setEvents(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [viewId]);

  function handleCompanySelect(companyId, companyName) {
    setViewId(companyId);
    setViewName(companyName);
  }

  const displayName = data?.companyName ?? viewName ?? 'Company';
  const labelHours  = TABLE_HOURS_OPTIONS.find((o) => o.hours === hours)?.label ?? `${hours}h`;

  return (
    <div>
      {/* Disclaimer */}
      <div style={{ marginBottom: 12, padding: '8px 14px', background: '#1e1440', border: '1px solid #4c1d95', borderRadius: 6, color: '#a78bfa', fontSize: 12 }}>
        Data is not reliably accurate. Items not tracked won't be listed. All data is inferred and likely to contain errors.
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CompanyLogo ic={data?.companyLogo} size={40} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e0e0f0' }}>{displayName}</h1>
              {data?.companyTag && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', background: '#1e1440', border: '1px solid #4c1d95', borderRadius: 4, padding: '1px 7px', letterSpacing: '0.05em' }}>
                  {data.companyTag}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6b6b8a', marginTop: 2 }}>Market activity overview</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <CompanySearchBar onSelect={handleCompanySelect} />
          <div style={{ display: 'flex', gap: 4 }}>
            {TABLE_HOURS_OPTIONS.map((o) => (
              <button
                key={o.hours}
                onClick={() => setHours(o.hours)}
                style={{
                  background: hours === o.hours ? '#1e1440' : 'none',
                  border: `1px solid ${hours === o.hours ? '#4c1d95' : '#2e2e5a'}`,
                  borderRadius: 6, padding: '5px 11px',
                  color: hours === o.hours ? '#a78bfa' : '#6b6b8a',
                  fontSize: 12, fontWeight: hours === o.hours ? 600 : 400, cursor: 'pointer',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 16 }}>{err}</div>}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <Spinner />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Top row: activity feed left, chart right */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, alignItems: 'stretch' }}>
            <ActivityFeed events={events} companyName={displayName} />
            <ActivityChart viewId={viewId} companyName={displayName} />
          </div>

          {/* Full-width items table */}
          {data?.items?.length > 0 ? (
            <ItemsTable items={data.items} labelHours={labelHours} />
          ) : (
            <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '40px 20px', textAlign: 'center', color: '#3a3a55', fontSize: 13 }}>
              No item activity found in the last {labelHours}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
