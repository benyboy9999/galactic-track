import { useState, useMemo } from 'react';
import { useAsync } from '../hooks/useAsync';
import { api } from '../api';
import Spinner from '../components/Spinner';
import ErrorMsg from '../components/ErrorMsg';

const c = (v) => (v == null ? '—' : `$${(v / 100).toFixed(2)}`);
const cHr = (v) => (v == null ? '—' : `$${(v / 100).toFixed(2)}/hr`);
const profitCls = (v) => (v == null ? 'muted' : v > 0 ? 'green' : v < 0 ? 'red' : 'muted');

function RecipeRow({ recipe, expanded, onToggle, showOptional }) {
  const profit = showOptional ? recipe.profitWithOptional : recipe.profit;
  const pph    = showOptional ? recipe.profitPerHourWithOptional : recipe.profitPerHour;

  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }} className={expanded ? 'row-expanded' : ''}>
        <td>{recipe.recipeName}</td>
        <td className="muted">{recipe.buildingName ?? '—'}</td>
        <td className="muted">{recipe.timeMinutes != null ? `${recipe.timeMinutes} min` : '—'}</td>
        <td>{c(recipe.inputCost)}</td>
        <td>
          {c(recipe.workerCostPerRun)}
          {showOptional && recipe.workerOptionalPerRun > 0
            ? <span className="muted"> +{c(recipe.workerOptionalPerRun)}</span>
            : null}
        </td>
        <td>{c(recipe.outputRevenue)}</td>
        <td className={profitCls(profit)}>{c(profit)}</td>
        <td className={profitCls(pph)}>{cHr(pph)}</td>
        <td className="muted">{recipe.margin != null ? `${recipe.margin}%` : '—'}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ background: '#0d0d22', padding: '1.2rem 1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>

              {/* Inputs */}
              <div>
                <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Input Materials</div>
                {recipe.inputs.length === 0
                  ? <div className="muted">None (extraction)</div>
                  : <table>
                      <thead><tr><th>Material</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
                      <tbody>
                        {recipe.inputs.map((inp, i) => (
                          <tr key={i}>
                            <td>{inp.matName}</td>
                            <td>{inp.qty}</td>
                            <td>{c(inp.unitPrice)}</td>
                            <td>{c(inp.totalCost)}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '1px solid #1e1e3a' }}>
                          <td colSpan={3} style={{ color: '#888' }}>Total</td>
                          <td>{c(recipe.inputCost)}</td>
                        </tr>
                      </tbody>
                    </table>
                }
              </div>

              {/* Output */}
              <div>
                <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Output</div>
                <table>
                  <thead><tr><th>Material</th><th>Qty</th><th>Unit</th><th>Revenue</th></tr></thead>
                  <tbody>
                    {recipe.outputs.map((out, i) => (
                      <tr key={i}>
                        <td>{out.matName}</td>
                        <td>{out.qty}</td>
                        <td>{c(out.unitPrice)}</td>
                        <td>{c(out.totalRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Workers */}
              <div>
                <div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>
                  Worker Overhead <span style={{ color: '#555', fontWeight: 400 }}>(per {recipe.timeMinutes}-min run)</span>
                </div>
                {recipe.workers.length === 0
                  ? <div className="muted">No workers required</div>
                  : recipe.workers.map((wg, wi) => (
                      <div key={wi} style={{ marginBottom: '0.75rem' }}>
                        <div style={{ color: '#aaa', marginBottom: 4, fontSize: 12 }}>
                          Type {wg.workerType} × {wg.count.toLocaleString()} workers
                        </div>
                        <table>
                          <tbody>
                            <tr>
                              <td style={{ color: '#888' }}>Admin wages/day</td>
                              <td colSpan={2}>{c(wg.adminDailyTotal)}</td>
                            </tr>
                            {wg.consumables.map((cc, ci) => (
                              <tr key={ci} style={{ opacity: cc.essential ? 1 : 0.5 }}>
                                <td>
                                  {cc.matName}
                                  {!cc.essential && <span style={{ color: '#555', fontSize: 11 }}> opt</span>}
                                </td>
                                <td style={{ color: '#888' }}>{cc.dailyQty}/day</td>
                                <td>{c(cc.dailyCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))
                }
                <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 8, marginTop: 4, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>Daily (essential)</span>
                    <span>{c(recipe.dailyWorkerCostEssential)}</span>
                  </div>
                  {recipe.dailyWorkerCostOptional > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.5 }}>
                      <span style={{ color: '#888' }}>Daily (optional)</span>
                      <span>{c(recipe.dailyWorkerCostOptional)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ color: '#888' }}>Per run (essential)</span>
                    <strong>{c(recipe.workerCostPerRun)}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div style={{ marginTop: '1rem', padding: '0.6rem 1rem', background: '#13132a', borderRadius: 6, display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: 13 }}>
              <span>Revenue: <strong>{c(recipe.outputRevenue)}</strong></span>
              <span>Inputs: <strong style={{ color: '#f87171' }}>−{c(recipe.inputCost)}</strong></span>
              <span>Workers: <strong style={{ color: '#f87171' }}>−{c(recipe.workerCostPerRun)}</strong></span>
              <span>Profit/run: <strong className={profitCls(recipe.profit)}>{c(recipe.profit)}</strong></span>
              <span>Profit/hr: <strong className={profitCls(recipe.profitPerHour)}>{cHr(recipe.profitPerHour)}</strong></span>
            </div>

            {recipe.dataMissing && (
              <div style={{ marginTop: 8, color: '#fbbf24', fontSize: 12 }}>
                ⚠ Some prices unavailable — profit may be understated.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Profits() {
  const [excludeMissing, setExcludeMissing] = useState(true);
  const [buildingFilter, setBuildingFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [sort, setSort] = useState({ key: 'profitPerHour', dir: -1 });

  const { data, loading, error, refresh } = useAsync(
    () => api.profits({ excludeMissing: excludeMissing ? 'true' : 'false' }),
    [excludeMissing],
    { lazy: true }
  );

  const buildings = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.map((r) => r.buildingName).filter(Boolean))].sort();
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    let filtered = data;
    if (buildingFilter) filtered = filtered.filter((r) => r.buildingName === buildingFilter);
    if (search) filtered = filtered.filter((r) => r.recipeName?.toLowerCase().includes(search.toLowerCase()));
    const sortKey = showOptional && sort.key === 'profitPerHour'
      ? 'profitPerHourWithOptional'
      : sort.key;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return av < bv ? sort.dir : av > bv ? -sort.dir : 0;
    });
  }, [data, buildingFilter, search, sort, showOptional]);

  function toggleSort(key) {
    setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: -1 });
  }

  function SH({ colKey, label }) {
    const active = sort.key === colKey;
    return (
      <th onClick={() => toggleSort(colKey)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        {label}{active ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
      </th>
    );
  }

  const positiveCount = rows.filter((r) => (showOptional ? r.profitWithOptional : r.profit) > 0).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Production Profit Calculator</h2>
        <button className="btn-secondary" onClick={refresh}>Refresh Prices</button>
      </div>

      <div className="filters">
        <input
          className="search-input"
          placeholder="Search recipes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, marginBottom: 0 }}
        />
        <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)} className="select-input">
          <option value="">All Buildings</option>
          {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <label className="checkbox-label">
          <input type="checkbox" checked={excludeMissing} onChange={(e) => setExcludeMissing(e.target.checked)} />
          Hide incomplete
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={showOptional} onChange={(e) => setShowOptional(e.target.checked)} />
          Include optional worker costs
        </label>
      </div>

      {loading && <Spinner />}
      {error && <ErrorMsg message={error} />}

      {!loading && !error && !data && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b6b8a' }}>
          <div style={{ marginBottom: 12 }}>No data loaded — click to calculate profits using current market prices.</div>
          <button className="btn-secondary" onClick={refresh}>Load data</button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div style={{ marginBottom: '0.75rem', color: '#888', fontSize: 12 }}>
            {positiveCount} profitable / {rows.length} shown — click a row to expand.
            {showOptional && <span style={{ color: '#fbbf24', marginLeft: 8 }}>Optional worker costs included.</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SH colKey="recipeName"       label="Recipe" />
                  <SH colKey="buildingName"     label="Building" />
                  <SH colKey="timeMinutes"      label="Duration" />
                  <SH colKey="inputCost"        label="Inputs" />
                  <SH colKey="workerCostPerRun" label="Workers/run" />
                  <SH colKey="outputRevenue"    label="Revenue" />
                  <SH colKey="profit"           label="Profit/run" />
                  <SH colKey="profitPerHour"    label="Profit/hr" />
                  <SH colKey="margin"           label="Margin" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RecipeRow
                    key={r.recipeId}
                    recipe={r}
                    expanded={expandedId === r.recipeId}
                    onToggle={() => setExpandedId(expandedId === r.recipeId ? null : r.recipeId)}
                    showOptional={showOptional}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
