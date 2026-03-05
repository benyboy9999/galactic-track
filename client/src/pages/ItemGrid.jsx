import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

// Manual overrides where API name ≠ sprite ID
const ICON_OVERRIDES = {
  // Plural → singular
  'Cows':                             'Cow',
  'Chickens':                         'Chicken',
  // Spelling / abbreviation differences
  'Copper Wire':                      'CopperWiring',
  'Consumer Electronics':             'Electronics',
  'Electric Motor':                   'Motor',
  'Artificial Intelligence':          'AI',
  'Advanced Processing Unit':         'APU',
  'Nanites':                          'Nanobots',
  'Bio-Nutrient Blend':               'NutrientBlend',
  'Hydrogen Fuel':                    'HydrogenFuelCell',
  'Superconducting Coil':             'HyperCoil',
  'Field Cooling System':             'FieldCooling',
  // API name lacks tier prefix that sprite has
  'Iron':                             'IronBar',
  'Copper':                           'CopperBar',
  'Rations':                          'BasicRations',
  'Exosuit':                          'BasicExosuit',
  'Tools':                            'BasicTools',
  'Construction Kit':                 'BasicConstructionKit',
  'Prefab Kit':                       'BasicPrefabKit',
  'Amenities':                        'BasicAmenities',
  'Hull Plate':                       'BasicHullPlate',
  'Linear FTL Emitter':               'BasicFTLEmitter',
  'Truss':                            'ReinforcedTruss',
  'Titanium Carbide Drill':           'AdvancedDrill',
  // Ship bridges (T1 → T4)
  'Shuttle Bridge':                   'BasicShipBridge',
  'Hauler Bridge':                    'AdvancedShipBridge',
  'Freighter Bridge':                 'T4ShipBridge',
  // FTL tiers
  'Quantum FTL Emitter':              'AdvancedFTLEmitter',
  'Extra-dimensional FTL Emitter':    'SuperiorFTLEmitter',
  // Ship elements
  'Starlifter Structural Elements':   'T4ShipElements',
  // Renamed / unexpected sprite IDs
  'Molecular Fusion Kit':             'WeldingKit2',
  'Ethanol':                          'Gasoline',
  'Graphenium Wire':                  'Superconductors',
  'Starglass Hull Plate':             'QuadraniumHullPlate',
  // Pack / shipment items
  'Medicine Shipment':                'Pack_Medicine',
  'Food Shipment':                    'Pack_Food',
  'Ship Parts Shipment':              'Pack_ShipParts',
  'Defense systems pack':             'Pack_Defense',
  'Habitats Shipment':                'Pack_Habitats',
  'Scientific Instruments Shipment':  'Pack_Scientific',
  'Gifts':                            'Pack_Gifts',
};

// "Basic Construction Kit" → "BasicConstructionKit"
function toIconId(name) {
  if (ICON_OVERRIDES[name]) return ICON_OVERRIDES[name];
  return name.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function CreditPips({ used, total }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: i < used ? '#a78bfa' : '#2e2e5a',
        }} />
      ))}
    </span>
  );
}

export default function ItemGrid() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState('');
  const [search,     setSearch]     = useState('');
  const [confirming, setConfirming] = useState(null); // item obj being confirmed
  const [working,    setWorking]    = useState(null); // matId being tracked
  const creditsUsed  = user?.creditsUsed  ?? 0;
  const creditsTotal = user?.creditsTotal ?? 3;
  const full = creditsUsed >= creditsTotal;

  // Same-origin proxy — avoids cross-origin SVG <use> CORS block
  const spriteUrl = '/api/gamedata/sprite';

  const loadItems = useCallback(async () => {
    try {
      setItems(await api.allItems());
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.matName.toLowerCase().includes(q)) : items;
  }, [items, search]);

  async function handleTrack() {
    if (!confirming) return;
    setWorking(confirming.matId);
    setErr('');
    try {
      await api.trackItem(confirming.matId);
      await Promise.all([loadItems(), refreshUser()]);
      setConfirming(null);
      navigate('/tracker');
    } catch (e) {
      setErr(e.message);
      setConfirming(null);
    } finally {
      setWorking(null);
    }
  }

  function handleCardClick(item) {
    if (item.tracked) {
      navigate('/tracker');
    } else if (!full) {
      setConfirming(item);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: '#e0e0ff' }}>Items</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b6b8a' }}>
            Click a tracked item to open its tracker. Click an untracked item to start tracking it.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#6b6b8a' }}>
          <CreditPips used={creditsUsed} total={creditsTotal} />
          <span>{creditsUsed}/{creditsTotal} credits used</span>
          {full && <span style={{ color: '#fbbf24' }}>— limit reached</span>}
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search items…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: 20,
          background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 6,
          padding: '10px 14px', color: '#e0e0ff', fontSize: 13,
        }}
      />

      {/* Error */}
      {err && <p style={{ color: '#f87171', marginBottom: 16, fontSize: 13 }}>{err}</p>}

      {/* Grid */}
      {loading ? (
        <p style={{ color: '#6b6b8a', textAlign: 'center', marginTop: 60 }}>Loading…</p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 10,
        }}>
          {filtered.map((item) => {
            const isMine   = item.tracked && item.trackedBy === user?.companyName;
            const isOthers = item.tracked && !isMine;
            const clickable = item.tracked || !full;

            let borderColor = '#2e2e5a';
            let bg          = '#0d0d22';
            let nameColor   = '#9090b0';
            if (isMine)   { borderColor = '#a78bfa'; bg = '#12082a'; nameColor = '#e0e0ff'; }

            return (
              <div
                key={item.matId}
                onClick={() => clickable && handleCardClick(item)}
                title={
                  isMine   ? 'Your item — click to open tracker' :
                  isOthers ? `Tracked by ${item.trackedBy ?? 'another user'} — click to view` :
                  full     ? 'No credits remaining' :
                             `Track ${item.matName} (1 credit)`
                }
                style={{
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 8,
                  padding: '14px 12px',
                  cursor: clickable ? 'pointer' : 'default',
                  opacity: isOthers ? 0.6 : 1,
                  transition: 'border-color 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  minHeight: 80,
                }}
                onMouseEnter={(e) => { if (clickable) e.currentTarget.style.borderColor = isMine ? '#c4b5fd' : '#4a4a8a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderColor; }}
              >
                {spriteUrl && (
                  <svg width="36" height="36" style={{ flexShrink: 0 }}>
                    <use href={`${spriteUrl}#${toIconId(item.matName)}`} width="36" height="36" />
                  </svg>
                )}
                <span style={{ fontSize: 13, fontWeight: 500, color: nameColor, lineHeight: 1.3 }}>
                  {item.matName}
                </span>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto' }}>
                  {item.tier && (
                    <span style={{
                      fontSize: 10, color: '#4a4a6a',
                      background: '#13132a', border: '1px solid #1e1e3a',
                      borderRadius: 4, padding: '1px 6px',
                    }}>
                      T{item.tier}
                    </span>
                  )}
                  {item.category && (
                    <span style={{
                      fontSize: 10, color: '#4a4a6a',
                      background: '#13132a', border: '1px solid #1e1e3a',
                      borderRadius: 4, padding: '1px 6px',
                    }}>
                      {item.category}
                    </span>
                  )}
                  {isMine && (
                    <span style={{
                      fontSize: 10, color: '#a78bfa',
                      background: '#1e1440', borderRadius: 4, padding: '1px 6px',
                    }}>
                      Tracked
                    </span>
                  )}
                  {isOthers && (
                    <span style={{
                      fontSize: 10, color: '#6b6b8a',
                      background: '#13132a', border: '1px solid #2e2e5a',
                      borderRadius: 4, padding: '1px 6px',
                    }}>
                      Tracked
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm modal */}
      {confirming && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirming(null); }}
        >
          <div style={{ background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 10, padding: 28, width: 340, textAlign: 'center' }}>
            <p style={{ margin: '0 0 6px', color: '#e0e0ff', fontSize: 15, fontWeight: 600 }}>
              Track {confirming.matName}?
            </p>
            <p style={{ margin: '0 0 24px', color: '#6b6b8a', fontSize: 13 }}>
              This will use 1 credit ({creditsUsed + 1}/{creditsTotal} after).
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => setConfirming(null)}
                style={{ background: 'none', border: '1px solid #2e2e5a', borderRadius: 6, padding: '8px 20px', color: '#6b6b8a', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleTrack}
                disabled={!!working}
                style={{ background: '#1e0a3a', border: '1px solid #4c1d95', borderRadius: 6, padding: '8px 20px', color: '#a78bfa', fontSize: 13, cursor: working ? 'not-allowed' : 'pointer', opacity: working ? 0.6 : 1 }}
              >
                {working ? 'Tracking…' : 'Track item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
