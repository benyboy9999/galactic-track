import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { toSlug } from '../utils/slug';

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

export default function ItemGrid() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState('');
  const [search,      setSearch]      = useState('');
  const [tierFilter,  setTierFilter]  = useState(null);  // null = all
  const [catFilter,   setCatFilter]   = useState('');    // '' = all
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [favourites,  setFavourites]  = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('gt-favourites') ?? '[]')); }
    catch { return new Set(); }
  });

  const spriteUrl   = '/api/gamedata/sprite';
  const creditsUsed = user?.creditsUsed ?? 0;

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

  const categories = useMemo(() => {
    const seen = new Set();
    items.forEach((i) => { if (i.category) seen.add(i.category); });
    return [...seen].sort();
  }, [items]);

  const tiers = useMemo(() => {
    const seen = new Set();
    items.forEach((i) => { if (i.tier) seen.add(i.tier); });
    return [...seen].sort((a, b) => a - b);
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (q && !i.matName.toLowerCase().includes(q)) return false;
      if (tierFilter !== null && i.tier !== tierFilter) return false;
      if (catFilter && i.category !== catFilter) return false;
      return true;
    });
  }, [items, search, tierFilter, catFilter]);

  function toggleFavourite(e, matId) {
    e.stopPropagation();
    setFavourites((prev) => {
      const next = new Set(prev);
      next.has(matId) ? next.delete(matId) : next.add(matId);
      localStorage.setItem('gt-favourites', JSON.stringify([...next]));
      return next;
    });
  }

  const trackedItems   = filtered.filter((i) => i.tracked)
    .sort((a, b) => (favourites.has(b.matId) ? 1 : 0) - (favourites.has(a.matId) ? 1 : 0));
  const untrackedItems = filtered.filter((i) => !i.tracked);

  function handleCardClick(item) {
    if (item.tracked && creditsUsed === 0 && !import.meta.env.DEV) {
      setPromoteOpen(true);
    } else {
      navigate(`/${toSlug(item.matName)}`);
    }
  }

  function ItemCard({ item }) {
    const isUntracked = !item.tracked;
    const isFav = favourites.has(item.matId);

    const borderColor = item.tracked ? '#2e2e5a' : '#1a1a36';
    const bg          = item.tracked ? '#0d0d22' : '#080818';
    const nameColor   = item.tracked ? '#e0e0f0' : '#4a4a6a';

    return (
      <div
        onClick={() => handleCardClick(item)}
        style={{
          background: bg, border: `1px solid ${borderColor}`, borderRadius: 8,
          padding: '14px 12px', cursor: 'pointer', transition: 'border-color 0.15s',
          display: 'flex', flexDirection: 'column', gap: 6, minHeight: 80, position: 'relative',
          opacity: isUntracked ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = item.tracked ? '#4a4a8a' : '#2a2a50';
          e.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = borderColor;
          e.currentTarget.style.opacity = isUntracked ? '0.5' : '1';
        }}
      >
        {item.tracked && (
          <button
            onClick={(e) => toggleFavourite(e, item.matId)}
            title={isFav ? 'Unpin' : 'Pin to top'}
            style={{
              position: 'absolute', top: 8, right: 8,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, lineHeight: 1, padding: 2,
              color: isFav ? '#fbbf24' : '#2e2e5a',
              opacity: isFav ? 1 : 0.6,
            }}
          >
            ★
          </button>
        )}
        <svg width="36" height="36" style={{ flexShrink: 0, filter: isUntracked ? 'grayscale(1)' : 'none' }}>
          <use href={`${spriteUrl}#${toIconId(item.matName)}`} width="36" height="36" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 500, color: nameColor, lineHeight: 1.3 }}>
          {item.matName}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto' }}>
          {item.tier && (
            <span style={{ fontSize: 10, color: '#3a3a5a', background: '#0d0d1e', border: '1px solid #1a1a30', borderRadius: 4, padding: '1px 6px' }}>
              T{item.tier}
            </span>
          )}
          {item.tracked && (
            <span style={{ fontSize: 10, color: '#5a5a7a', background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 4, padding: '1px 6px' }}>
              Tracked
            </span>
          )}
        </div>
      </div>
    );
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 10,
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#e0e0ff' }}>Currently Tracked Items</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b6b8a' }}>
          Items here are currently being tracked. Not sure what to track? Pick a high-volume item you sell!
        </p>
      </div>

      <input
        type="text"
        placeholder="Search items…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: 12,
          background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 6,
          padding: '10px 14px', color: '#e0e0ff', fontSize: 13,
        }}
      />

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        {/* Tier chips */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[null, ...tiers].map((t) => (
            <button
              key={t ?? 'all'}
              onClick={() => setTierFilter(t)}
              style={{
                background: tierFilter === t ? '#1e1440' : 'none',
                border: `1px solid ${tierFilter === t ? '#7c3aed' : '#2e2e5a'}`,
                borderRadius: 4, padding: '3px 8px',
                color: tierFilter === t ? '#a78bfa' : '#6b6b8a',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              {t === null ? 'All tiers' : `T${t}`}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: '#1e1e3a' }} />

        {/* Category select */}
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          style={{
            background: catFilter ? '#1e1440' : '#13132a',
            border: `1px solid ${catFilter ? '#7c3aed' : '#2e2e5a'}`,
            borderRadius: 4, padding: '3px 8px',
            color: catFilter ? '#a78bfa' : '#6b6b8a',
            fontSize: 11, cursor: 'pointer',
          }}
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {err && <p style={{ color: '#f87171', marginBottom: 16, fontSize: 13 }}>{err}</p>}

      {loading ? (
        <p style={{ color: '#6b6b8a', textAlign: 'center', marginTop: 60 }}>Loading…</p>
      ) : (
        <>
          {trackedItems.length > 0 && (
            <>
              <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Being tracked
              </div>
              <div style={gridStyle}>
                {trackedItems.map((item) => <ItemCard key={item.matId} item={item} />)}
              </div>
              <div style={{ borderTop: '1px solid #1e1e3a', margin: '24px 0 20px' }} />
            </>
          )}

          {untrackedItems.length > 0 && (
            <>
              <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Not yet tracked
              </div>
              <div style={gridStyle}>
                {untrackedItems.map((item) => <ItemCard key={item.matId} item={item} />)}
              </div>
            </>
          )}
        </>
      )}

      {/* Promote modal — shown to users who haven't tracked any items yet */}
      {promoteOpen && (
        <div
          onClick={() => setPromoteOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 10, padding: '32px 28px', width: 360, textAlign: 'center' }}
          >
            <div style={{ fontSize: 28, marginBottom: 16 }}>📊</div>
            <p style={{ margin: '0 0 10px', color: '#e0e0ff', fontSize: 15, fontWeight: 600 }}>
              Track at least 1 item first!
            </p>
            <p style={{ margin: '0 0 24px', color: '#6b6b8a', fontSize: 13, lineHeight: 1.6 }}>
              Pick up to 3 items from the <em>Not yet tracked</em> section below to start collecting
              market data. Once you're tracking at least 1 item of your own you'll be able to view all tracked
              items on the platform.
            </p>
            <button
              onClick={() => setPromoteOpen(false)}
              style={{ background: '#1e0a3a', border: '1px solid #4c1d95', borderRadius: 6, padding: '9px 28px', color: '#a78bfa', fontSize: 13, cursor: 'pointer' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
