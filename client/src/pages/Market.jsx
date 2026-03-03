import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import { api } from '../api';
import Spinner from '../components/Spinner';
import ErrorMsg from '../components/ErrorMsg';
import Sparkline from '../components/Sparkline';

// ── Formatters ────────────────────────────────────────────────────────────────
const usd   = (v) => v > 0 ? `$${(v / 100).toFixed(2)}` : '—';
const pct   = (v) => v > 0 ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
const qty   = (v) => {
  if (v == null) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
};

// ── Supply signal config ──────────────────────────────────────────────────────
const SIGNAL = {
  draining_fast: { label: '▼▼ Draining',  color: '#f87171', bg: 'rgba(248,113,113,0.08)' },
  draining:      { label: '▼ Draining',   color: '#fbbf24', bg: 'rgba(251,191,36,0.08)'  },
  stable:        { label: '→ Stable',      color: '#6b6b8a', bg: 'transparent'             },
  growing:       { label: '▲ Growing',     color: '#10b981', bg: 'rgba(16,185,129,0.08)'  },
};

function SignalBadge({ signal }) {
  const s = SIGNAL[signal] ?? SIGNAL.stable;
  return (
    <span style={{
      color: s.color, background: s.bg,
      padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function DaysCell({ days }) {
  if (days == null) return <span className="muted">—</span>;
  const color = days < 3 ? '#f87171' : days < 7 ? '#fbbf24' : '#10b981';
  return <span style={{ color, fontWeight: 600 }}>{days < 100 ? days.toFixed(1) : '100+'}</span>;
}

function PriceDelta({ current, avg }) {
  if (current <= 0 || avg <= 0) return <span className="muted">—</span>;
  const diff = ((current - avg) / avg) * 100;
  const color = diff < 0 ? '#10b981' : diff > 5 ? '#f87171' : '#6b6b8a';
  return <span style={{ color, fontSize: 11 }}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}%</span>;
}

// ── Expanded order book ───────────────────────────────────────────────────────
function OrderBook({ mat }) {
  const orders = mat.orders ?? [];
  if (!orders.length) return <div className="muted" style={{ padding: '0.5rem' }}>No active sell orders.</div>;

  const totalSupply = orders.reduce((s, o) => s + o.qty, 0);

  return (
    <table style={{ fontSize: 12 }}>
      <thead>
        <tr>
          <th>Company</th>
          <th style={{ textAlign: 'right' }}>Price</th>
          <th style={{ textAlign: 'right' }}>Qty</th>
          <th style={{ textAlign: 'right' }}>Total Value</th>
          <th style={{ textAlign: 'right' }}>% of Listings</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td style={{ color: '#c0c0d8' }}>{o.cName}</td>
            <td style={{ textAlign: 'right' }}>{usd(o.unitPrice)}</td>
            <td style={{ textAlign: 'right' }}>{qty(o.qty)}</td>
            <td style={{ textAlign: 'right', color: '#6b6b8a' }}>{usd(o.unitPrice * o.qty)}</td>
            <td style={{ textAlign: 'right', color: '#6b6b8a' }}>
              {totalSupply > 0 ? ((o.qty / totalSupply) * 100).toFixed(1) : 0}%
            </td>
          </tr>
        ))}
        <tr style={{ borderTop: '1px solid #1e1e3a' }}>
          <td colSpan={2} style={{ color: '#6b6b8a' }}>Total listed</td>
          <td style={{ textAlign: 'right' }}>{qty(totalSupply)}</td>
          <td colSpan={2} />
        </tr>
      </tbody>
    </table>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────
function MatRow({ mat, expanded, onToggle, navigate }) {
  const priceDiff = mat.currentPrice > 0 && mat.avgPrice > 0
    ? ((mat.currentPrice - mat.avgPrice) / mat.avgPrice) * 100
    : null;
  const rowBg = SIGNAL[mat.supplySignal]?.bg ?? 'transparent';

  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer', background: expanded ? '#13132a' : rowBg }}
      >
        <td style={{ fontWeight: 500 }}>{mat.matName}</td>

        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkline values={mat.sparkline} width={72} height={24} />
          </div>
        </td>

        <td>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{usd(mat.currentPrice)}</span>
          {' '}
          <PriceDelta current={mat.currentPrice} avg={mat.avgPrice} />
        </td>

        <td style={{ color: '#6b6b8a', fontSize: 12 }}>{usd(mat.avgPrice)}</td>

        <td style={{ textAlign: 'right' }}>{qty(mat.totalQtyAvailable)}</td>

        <td style={{ textAlign: 'right' }}><DaysCell days={mat.daysRemaining} /></td>

        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SignalBadge signal={mat.supplySignal} />
            <span style={{ color: mat.avgDailyChange < 0 ? '#f87171' : '#10b981', fontSize: 11 }}>
              {mat.avgDailyChange > 0 ? '+' : ''}{qty(mat.avgDailyChange)}/day
            </span>
          </div>
        </td>

        <td>
          <button
            className="btn-link"
            onClick={(e) => { e.stopPropagation(); navigate(`/market/${mat.matId}`); }}
          >
            Chart →
          </button>
        </td>
      </tr>

      {expanded && (
        <tr style={{ background: '#0d0d22' }}>
          <td colSpan={8} style={{ padding: '0.75rem 1rem 1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '1.5rem' }}>
              {/* Order book */}
              <div>
                <div style={{ color: '#6b6b8a', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>
                  Active Sell Orders
                </div>
                <OrderBook mat={mat} />
              </div>

              {/* Stats */}
              <div style={{ fontSize: 12 }}>
                <div style={{ color: '#6b6b8a', fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>
                  Supply Stats
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <StatLine label="Current price"   value={usd(mat.currentPrice)} />
                  <StatLine label="7-day avg price"  value={usd(mat.avgPrice)} />
                  <StatLine label="Total available"  value={qty(mat.totalQtyAvailable)} />
                  <StatLine label="Avg daily volume" value={qty(mat.avgQtySoldDaily)} />
                  <StatLine label="Days of supply"   value={mat.daysRemaining != null ? `${mat.daysRemaining.toFixed(1)} days` : '—'} />
                  <StatLine label="Avg daily Δ supply" value={`${mat.avgDailyChange > 0 ? '+' : ''}${qty(mat.avgDailyChange)}`}
                    valueColor={mat.avgDailyChange < 0 ? '#f87171' : '#10b981'} />
                </div>

                {mat.priceHistory?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: '#6b6b8a', fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>
                      7-Day Price History
                    </div>
                    <table style={{ fontSize: 11 }}>
                      <thead><tr><th>Date</th><th>Avg</th><th>Sold</th><th>Remaining</th></tr></thead>
                      <tbody>
                        {mat.priceHistory.slice(0, 7).map((h) => (
                          <tr key={h.date}>
                            <td style={{ color: '#6b6b8a' }}>{h.date}</td>
                            <td>{usd(h.avgPrice)}</td>
                            <td style={{ color: '#6b6b8a' }}>{qty(h.qtySold)}</td>
                            <td style={{ color: '#6b6b8a' }}>{qty(h.qtyRemaining)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatLine({ label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: '#6b6b8a' }}>{label}</span>
      <span style={{ color: valueColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Market() {
  const { data, loading, error, refresh } = useAsync(api.allDetails, [], { lazy: true });
  const [search, setSearch]         = useState('');
  const [signalFilter, setSignal]   = useState('');
  const [sort, setSort]             = useState({ key: 'daysRemaining', dir: 1 });
  const [expandedId, setExpandedId] = useState(null);
  const navigate = useNavigate();

  const rows = useMemo(() => {
    if (!data) return [];
    let out = data;
    if (search)       out = out.filter((m) => m.matName?.toLowerCase().includes(search.toLowerCase()));
    if (signalFilter) out = out.filter((m) => m.supplySignal === signalFilter);

    return [...out].sort((a, b) => {
      let av = a[sort.key] ?? (sort.dir === 1 ? Infinity : -Infinity);
      let bv = b[sort.key] ?? (sort.dir === 1 ? Infinity : -Infinity);
      if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv ?? '').toLowerCase(); }
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
  }, [data, search, signalFilter, sort]);

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 });
  }

  function SH({ colKey, label, title }) {
    const active = sort.key === colKey;
    return (
      <th onClick={() => toggleSort(colKey)} title={title}
          style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
        {label}{active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </th>
    );
  }

  const alertCount = rows.filter((m) =>
    (m.supplySignal === 'draining_fast' || m.supplySignal === 'draining') &&
    m.daysRemaining != null && m.daysRemaining < 7
  ).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Market</h2>
          {alertCount > 0 && (
            <div style={{ color: '#f87171', fontSize: 12, marginTop: 2 }}>
              {alertCount} item{alertCount > 1 ? 's' : ''} with draining supply &lt;7 days remaining
            </div>
          )}
        </div>
        <button className="btn-secondary" onClick={refresh}>Refresh</button>
      </div>

      <div className="filters">
        <input
          className="search-input"
          placeholder="Search materials..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <select value={signalFilter} onChange={(e) => setSignal(e.target.value)} className="select-input">
          <option value="">All signals</option>
          <option value="draining_fast">▼▼ Draining fast</option>
          <option value="draining">▼ Draining</option>
          <option value="stable">→ Stable</option>
          <option value="growing">▲ Growing</option>
        </select>
      </div>

      {loading && <Spinner />}
      {error && <ErrorMsg message={error} />}

      {!loading && !error && !data && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b6b8a' }}>
          <div style={{ marginBottom: 12 }}>No data loaded — click to fetch current market prices.</div>
          <button className="btn-secondary" onClick={refresh}>Load data</button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SH colKey="matName"       label="Material" />
                <th style={{ width: 80 }}>7-day price</th>
                <SH colKey="currentPrice"  label="Price" title="Current lowest ask vs 7-day avg" />
                <SH colKey="avgPrice"      label="7d Avg" />
                <SH colKey="totalQtyAvailable" label="Supply"  title="Total qty listed on exchange" style={{ textAlign: 'right' }} />
                <SH colKey="daysRemaining" label="Days left"   title="Supply ÷ avg daily volume" />
                <SH colKey="avgDailyChange" label="Supply trend" title="Weighted avg daily change in qty remaining (7 days)" />
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((mat) => (
                <MatRow
                  key={mat.matId}
                  mat={mat}
                  expanded={expandedId === mat.matId}
                  onToggle={() => setExpandedId(expandedId === mat.matId ? null : mat.matId)}
                  navigate={navigate}
                />
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0.5rem 1rem', color: '#3a3a55', fontSize: 11 }}>
            {rows.length} materials · click any row to expand order book · Chart → for price history
          </div>
        </div>
      )}
    </div>
  );
}
