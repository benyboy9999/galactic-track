import { useState, useEffect } from 'react';
import { api } from '../api';
import Spinner from '../components/Spinner';

const MAT = { IRON: 2, CONCRETE: 3, SILICA: 8, LIMESTONE: 34, PREFAB: 92 };

const MAT_META = {
  [MAT.IRON]:      { name: 'Iron',       color: '#60a5fa' },
  [MAT.CONCRETE]:  { name: 'Concrete',   color: '#a78bfa' },
  [MAT.SILICA]:    { name: 'Silica',     color: '#f59e0b' },
  [MAT.LIMESTONE]: { name: 'Limestone',  color: '#94a3b8' },
  [MAT.PREFAB]:    { name: 'Prefab Kit', color: '#34d399' },
};

const usd = (v) => v != null ? `$${(v / 100).toFixed(2)}` : '—';
const usdK = (v) => {
  if (v == null) return '—';
  const d = v / 100;
  const abs = Math.abs(d);
  const sign = d < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

function SectionLabel({ children }) {
  return (
    <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function RecipeCard({ recipe, highlightMatId, includeOptional }) {
  if (!recipe) return (
    <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
      <div style={{ color: '#3a3a55', fontSize: 12 }}>Recipe data unavailable</div>
    </div>
  );

  const workerCost    = recipe.workerCostPerRun + (includeOptional ? (recipe.workerOptionalPerRun ?? 0) : 0);
  const profit        = includeOptional ? recipe.profitWithOptional        : recipe.profit;
  const profitPerHour = includeOptional ? recipe.profitPerHourWithOptional : recipe.profitPerHour;

  return (
    <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: '#c0c0d8', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{recipe.recipeName}</div>
        <div style={{ color: '#6b6b8a', fontSize: 11 }}>{recipe.buildingName} · {recipe.timeMinutes} min/run</div>
      </div>

      {/* Inputs */}
      <div style={{ marginBottom: 6 }}>
        <SectionLabel>Inputs</SectionLabel>
        {recipe.inputs.map((inp) => (
          <div key={inp.matId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: inp.matId === highlightMatId ? '#a78bfa' : '#c0c0d8' }}>
              {inp.matName}
              <span style={{ color: '#6b6b8a', fontSize: 10 }}> ×{inp.qty.toLocaleString()}</span>
            </span>
            <span style={{ color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>-{usdK(inp.totalCost)}</span>
          </div>
        ))}
        {workerCost > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: '#6b6b8a' }}>Workers</span>
            <span style={{ color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>-{usdK(workerCost)}</span>
          </div>
        )}
      </div>

      {/* Output */}
      <div style={{ borderTop: '1px solid #1e1e3a', padding: '8px 0' }}>
        <SectionLabel>Output</SectionLabel>
        {recipe.outputs.map((out) => (
          <div key={out.matId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: '#c0c0d8' }}>
              {out.matName}
              <span style={{ color: '#6b6b8a', fontSize: 10 }}> ×{out.qty.toLocaleString()} @ {usd(out.unitPrice)}</span>
            </span>
            <span style={{ color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>+{usdK(out.totalRevenue)}</span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 8, display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#6b6b8a', fontSize: 10, marginBottom: 2 }}>Profit / run</div>
          <div style={{ color: profit >= 0 ? '#34d399' : '#f87171', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{usdK(profit)}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#6b6b8a', fontSize: 10, marginBottom: 2 }}>Profit / hr</div>
          <div style={{ color: profitPerHour >= 0 ? '#34d399' : '#f87171', fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{usdK(profitPerHour)}</div>
        </div>
      </div>
    </div>
  );
}

export default function Construction() {
  const [profits,         setProfits]         = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [includeOptional, setIncludeOptional] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    api.profits()
      .then(setProfits)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ padding: 32 }}><Spinner /></div>;
  if (error)   return <div style={{ padding: 16, color: '#f87171', fontSize: 13 }}>{error}</div>;

  // Best recipe (by profit/hr) for each output material
  const bestRecipe = (matId) =>
    [...profits]
      .filter((r) => r.outputs.some((o) => o.matId === matId))
      .sort((a, b) => b.profitPerHour - a.profitPerHour)[0] ?? null;

  const concreteRecipe = bestRecipe(MAT.CONCRETE);
  const prefabRecipe   = bestRecipe(MAT.PREFAB);

  // Build current price map from recipe data
  const priceMap = {};
  profits.forEach((r) => {
    [...r.inputs, ...r.outputs].forEach((m) => {
      if (m.unitPrice) priceMap[m.matId] = m.unitPrice;
    });
  });

  // ── Comparison: profit per hour for each production path ────────────────────
  let comparison = null;
  if (concreteRecipe && prefabRecipe) {
    const concreteWorkerCost = concreteRecipe.workerCostPerRun + (includeOptional ? (concreteRecipe.workerOptionalPerRun ?? 0) : 0);
    const prefabWorkerCost   = prefabRecipe.workerCostPerRun   + (includeOptional ? (prefabRecipe.workerOptionalPerRun   ?? 0) : 0);

    const concretePPH = includeOptional ? concreteRecipe.profitPerHourWithOptional : concreteRecipe.profitPerHour;
    const prefabPPH   = includeOptional ? prefabRecipe.profitPerHourWithOptional   : prefabRecipe.profitPerHour;
    const delta    = prefabPPH - concretePPH;
    const base     = Math.abs(concretePPH);
    const deltaPct = base > 0 ? +((delta / base) * 100).toFixed(1) : null;

    // ── Break-even concrete price ────────────────────────────────────────────
    // concretePPH(p) = prefabPPH(p) when concrete market price = p
    //
    // concretePPH(p) = (Rc·p  −  Ic)          × 60/Tc
    // prefabPPH(p)   = (Rp  −  Cp·p  −  Op  −  Wp) × 60/Tp
    //
    // Solving for p:
    //   p = [ Tc·(Rp − Op − Wp) + Tp·Ic ] / (Tp·Rc + Tc·Cp)

    const concreteInput = prefabRecipe.inputs.find((i) => i.matId === MAT.CONCRETE);
    let breakEvenPrice = null;

    if (concreteInput?.qty > 0) {
      const Tc = concreteRecipe.timeMinutes;
      const Tp = prefabRecipe.timeMinutes;
      const Rc = concreteRecipe.outputs.find((o) => o.matId === MAT.CONCRETE)?.qty ?? 1;
      const Cp = concreteInput.qty;
      const Ic = concreteRecipe.inputCost + concreteWorkerCost;           // fixed costs per concrete run
      const Rp = prefabRecipe.outputRevenue;                              // fixed prefab revenue per run
      const Op = prefabRecipe.inputs                                       // non-concrete input costs
        .filter((i) => i.matId !== MAT.CONCRETE)
        .reduce((s, i) => s + i.totalCost, 0);
      const Wp = prefabWorkerCost;

      const numerator   = Tc * (Rp - Op - Wp) + Tp * Ic;
      const denominator = Tp * Rc + Tc * Cp;
      if (denominator > 0) breakEvenPrice = numerator / denominator;
    }

    comparison = {
      concretePPH,
      prefabPPH,
      delta,
      deltaPct,
      betterPrefab: delta > 0,
      breakEvenPrice,
      currentConcretePrice: priceMap[MAT.CONCRETE] ?? null,
    };
  }

  const accentColor = comparison?.betterPrefab ? '#34d399' : '#a78bfa';

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid #1e1e3a', paddingBottom: 10 }}>
        <div style={{ color: '#c0c0d8', fontSize: 14, fontWeight: 700, letterSpacing: 0.5 }}>Construction</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b6b8a', cursor: 'pointer' }}>
            <input type="checkbox" checked={includeOptional} onChange={(e) => setIncludeOptional(e.target.checked)} style={{ accentColor: '#a78bfa' }} />
            Optional workers
          </label>
          <button className="btn-secondary" onClick={load} style={{ padding: '2px 10px', fontSize: 11 }}>Refresh</button>
        </div>
      </div>

      {/* Market prices */}
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
        <SectionLabel>Current market prices</SectionLabel>
        <div style={{ display: 'flex' }}>
          {Object.entries(MAT_META).map(([matId, meta]) => (
            <div key={matId} style={{ flex: 1 }}>
              <div style={{ color: '#6b6b8a', fontSize: 10, marginBottom: 3 }}>{meta.name}</div>
              <div style={{ color: meta.color, fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {priceMap[Number(matId)] ? usd(priceMap[Number(matId)]) : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recipe cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <RecipeCard recipe={concreteRecipe} includeOptional={includeOptional} />
        <RecipeCard recipe={prefabRecipe} highlightMatId={MAT.CONCRETE} includeOptional={includeOptional} />
      </div>

      {/* Comparison */}
      {comparison && (
        <div style={{ background: '#0d0d22', border: `1px solid ${accentColor}33`, borderRadius: 8, padding: '14px 18px' }}>
          <SectionLabel>Profit per hour — produce &amp; sell</SectionLabel>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', marginBottom: 14 }}>
            <div style={{ paddingRight: 20 }}>
              <div style={{ color: '#6b6b8a', fontSize: 11, marginBottom: 6 }}>Concrete</div>
              <div style={{ color: '#a78bfa', fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {usdK(comparison.concretePPH)}
              </div>
              <div style={{ color: '#3a3a55', fontSize: 10, marginTop: 3 }}>
                {concreteRecipe.timeMinutes} min/run · {concreteRecipe.outputs[0]?.qty ?? 1}× output
              </div>
            </div>
            <div style={{ background: '#1e1e3a' }} />
            <div style={{ paddingLeft: 20 }}>
              <div style={{ color: '#6b6b8a', fontSize: 11, marginBottom: 6 }}>Prefab Kit</div>
              <div style={{ color: '#34d399', fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {usdK(comparison.prefabPPH)}
              </div>
              <div style={{ color: '#3a3a55', fontSize: 10, marginTop: 3 }}>
                {prefabRecipe.timeMinutes} min/run · {prefabRecipe.outputs[0]?.qty ?? 1}× output
              </div>
            </div>
          </div>

          {/* Verdict */}
          <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              background: `${accentColor}18`,
              border: `1px solid ${accentColor}55`,
              borderRadius: 6, padding: '6px 14px',
              color: accentColor, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            }}>
              {comparison.betterPrefab ? 'Prefab Kit' : 'Concrete'}
            </div>
            {comparison.deltaPct !== null && (
              <div style={{ color: '#6b6b8a', fontSize: 12 }}>
                <span style={{ color: accentColor, fontWeight: 600 }}>
                  {comparison.betterPrefab ? '+' : ''}{comparison.deltaPct}%
                </span>
                {' more profit/hr — '}
                <span style={{ color: '#c0c0d8', fontVariantNumeric: 'tabular-nums' }}>
                  {usdK(Math.abs(comparison.delta))}
                </span>
                {'/hr difference'}
              </div>
            )}
          </div>

          {/* Break-even */}
          {comparison.breakEvenPrice != null && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#0a0a1a', borderRadius: 6, border: '1px solid #1e1e3a', fontSize: 12 }}>
              <span style={{ color: '#6b6b8a' }}>Break-even concrete price: </span>
              <span style={{ color: '#e0e0f0', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {usd(comparison.breakEvenPrice)}
              </span>
              {comparison.currentConcretePrice != null && (
                <>
                  <span style={{ color: '#3a3a55' }}> · current </span>
                  <span style={{ color: '#c0c0d8', fontVariantNumeric: 'tabular-nums' }}>{usd(comparison.currentConcretePrice)}</span>
                  <span style={{ color: '#3a3a55' }}> · </span>
                  <span style={{ color: '#6b6b8a' }}>
                    {comparison.betterPrefab
                      ? `concrete must rise above ${usd(comparison.breakEvenPrice)} for concrete production to win`
                      : `concrete must fall below ${usd(comparison.breakEvenPrice)} for prefab kits to win`}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!concreteRecipe && !prefabRecipe && (
        <div style={{ color: '#3a3a55', fontSize: 12 }}>No recipe data found — ensure gamedata is available.</div>
      )}
    </div>
  );
}
