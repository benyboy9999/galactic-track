import { useParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { useAsync } from '../hooks/useAsync';
import { api } from '../api';
import Spinner from '../components/Spinner';
import ErrorMsg from '../components/ErrorMsg';

const cents = (v) => (v > 0 ? `$${(v / 100).toFixed(2)}` : '—');

function PriceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-box">
      <div style={{ color: '#aaa', marginBottom: 4 }}>{new Date(label).toLocaleDateString()}</div>
      <div>Avg: <strong>{cents(payload[0]?.value)}</strong></div>
    </div>
  );
}

export default function MaterialDetail() {
  const { matId } = useParams();
  const { data: detail, loading: dLoading, error: dError, refresh: refreshDetail } = useAsync(
    () => api.matDetails(matId), [matId], { lazy: true }
  );
  const { data: history, loading: hLoading, error: hError, refresh: refreshHistory } = useAsync(
    () => api.priceHistory(matId), [matId], { lazy: true }
  );

  const loading = dLoading || hLoading;
  const error = dError || hError;
  const loaded = detail !== null || history !== null;

  function load() { refreshDetail(); refreshHistory(); }

  if (loading) return <Spinner />;
  if (error) return <ErrorMsg message={error} />;
  if (!loaded) return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b6b8a' }}>
      <div style={{ marginBottom: 12 }}>No data loaded — click to fetch current data for this material.</div>
      <button className="btn-secondary" onClick={load}>Load data</button>
    </div>
  );

  return (
    <div>
      <h2>{detail?.matName ?? `Material #${matId}`}</h2>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Current Price</div>
          <div className="stat-value">{cents(detail?.currentPrice)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Price</div>
          <div className="stat-value">{cents(detail?.avgPrice)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Supply Available</div>
          <div className="stat-value">{detail?.totalQtyAvailable?.toLocaleString() ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Daily Volume</div>
          <div className="stat-value">{detail?.avgQtySoldDaily?.toLocaleString() ?? '—'}</div>
        </div>
      </div>

      <h3>Sell Orders</h3>
      {detail?.orders?.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Price</th>
                <th>Quantity</th>
                <th>Total Value</th>
              </tr>
            </thead>
            <tbody>
              {detail.orders.slice(0, 20).map((o, i) => (
                <tr key={i}>
                  <td>{cents(o.price)}</td>
                  <td>{o.qty?.toLocaleString()}</td>
                  <td>{cents(o.price * o.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">No active sell orders.</p>}

      <h3>Price History (stored locally)</h3>
      {history?.length > 0 ? (
        <div style={{ height: 280, marginTop: '1rem' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a40" />
              <XAxis
                dataKey="hour"
                tickFormatter={(v) => new Date(v).toLocaleDateString()}
                stroke="#666"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickFormatter={(v) => `$${(v / 100).toFixed(2)}`}
                stroke="#666"
                tick={{ fontSize: 11 }}
                width={65}
              />
              <Tooltip content={<PriceTooltip />} />
              <Area
                type="monotone"
                dataKey="avg_price"
                stroke="#6366f1"
                fill="url(#priceGrad)"
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="muted">No local history yet — prices are recorded each time data is refreshed. Check back later.</p>
      )}

      {detail?.priceHistory?.length > 0 && (
        <>
          <h3>API Price History (30 days)</h3>
          <div style={{ height: 280, marginTop: '1rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={detail.priceHistory} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="apiGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a40" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => new Date(v).toLocaleDateString()}
                  stroke="#666"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 100).toFixed(2)}`}
                  stroke="#666"
                  tick={{ fontSize: 11 }}
                  width={65}
                />
                <Tooltip
                  formatter={(v) => [`$${(v / 100).toFixed(2)}`, 'Avg Price']}
                  labelFormatter={(v) => new Date(v).toLocaleDateString()}
                />
                <Area
                  type="monotone"
                  dataKey="avgPrice"
                  stroke="#10b981"
                  fill="url(#apiGrad)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
