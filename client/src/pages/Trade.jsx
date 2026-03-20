import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { toIconId } from '../utils/materialIcon';

const SPRITE_URL = '/api/gamedata/sprite';

// ── Company logo decoder (same as Contracts.jsx) ──────────────────────────────

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

function CompanyLogo({ ic, size = 18 }) {
  const logo = useMemo(() => ic ? decodeCompanyLogo(ic) : null, [ic]);
  if (!logo) return null;
  const px = size / 7;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <rect width={size} height={size} fill="#0a0a18" rx={2} />
      {logo.pixels.map((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill={logo.color} /> : null
        )
      )}
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STOCK_LABELS = { high: 'High',  low: 'Low', to_order: 'To Order' };
const STOCK_COLORS = { high: '#22c55e', low: '#f59e0b', to_order: '#a78bfa' };

function fmtPrice(type, value) {
  if (type === 'fixed')         return Number(value).toLocaleString();
  if (type === 'average')       return 'Avg';
  return `Market ${value}`;
}

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Location helpers (transplanted from Contracts.jsx) ────────────────────────

function buildLocation(atExchange, planet) {
  if (atExchange && planet) return `Exchange Station, ${planet}`;
  if (atExchange)           return 'Exchange Station';
  return planet;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToggleGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {options.map(({ label, val }) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          style={{
            padding: '5px 10px',
            background: value === val ? '#3730a3' : 'transparent',
            border: `1px solid ${value === val ? '#4f46e5' : '#2a2a4a'}`,
            borderRadius: 5, color: value === val ? '#d8d8f0' : '#6b6b8a',
            fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >{label}</button>
      ))}
    </div>
  );
}

function ItemSearch({ items, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const wrapRef           = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items.filter((i) => i.matName.toLowerCase().includes(q)).slice(0, 12);
  }, [items, query]);

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search items…"
        style={{
          width: '100%', padding: '7px 10px', background: '#0d0d1f',
          border: '1px solid #2a2a4a', borderRadius: 6, color: '#d8d8f0',
          fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#0d0d1f', border: '1px solid #2a2a4a', borderRadius: 6,
          marginTop: 2, maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.map((item) => (
            <div
              key={item.matId}
              onMouseDown={() => { onSelect(item); setQuery(''); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#1a1a35'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width={18} height={18} style={{ flexShrink: 0 }}>
                <use href={`${SPRITE_URL}#${toIconId(item.matName)}`} width={18} height={18} />
              </svg>
              <span style={{ fontSize: 13, color: '#b0b0cc' }}>{item.matName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocationPicker({ planets, atExchange, setAtExchange, planet, setPlanet, planetSearch, setPlanetSearch }) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 6 }}>
        <input
          type="checkbox" checked={atExchange} onChange={(e) => setAtExchange(e.target.checked)}
          style={{ accentColor: '#7c3aed', width: 14, height: 14 }}
        />
        <span style={{ fontSize: 12, color: atExchange ? '#e0e0ff' : '#6b6b8a' }}>Exchange Station</span>
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type="text" value={planetSearch} placeholder="+ Add a planet (optional)"
          onChange={(e) => { setPlanetSearch(e.target.value); setPlanet(''); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          style={{
            width: '100%', boxSizing: 'border-box', background: '#0d0d1f',
            border: `1px solid ${planet ? '#4c1d95' : '#2a2a4a'}`, borderRadius: 5,
            padding: '7px 10px', color: '#e0e0ff', fontSize: 12, outline: 'none',
          }}
        />
        {focused && planetSearch && !planet && (() => {
          const q = planetSearch.toLowerCase();
          const matches = planets.filter((p) => p !== 'Exchange Station' && p.toLowerCase().includes(q)).slice(0, 12);
          return matches.length > 0 ? (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
              background: '#0d0d1f', border: '1px solid #2a2a4a', borderRadius: 5,
              marginTop: 2, maxHeight: 180, overflowY: 'auto',
            }}>
              {matches.map((p) => (
                <div key={p} onMouseDown={() => { setPlanet(p); setPlanetSearch(p); }}
                  style={{ padding: '7px 10px', fontSize: 12, color: '#c4c4e0', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#1e1e3a'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >{p}</div>
              ))}
            </div>
          ) : null;
        })()}
      </div>
      {!atExchange && !planet && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171' }}>Select Exchange Station or a planet</p>
      )}
    </div>
  );
}

// ── Listing card (guild members) ──────────────────────────────────────────────

function ListingCard({ listing }) {
  return (
    <div style={{
      background: '#0d0d22', border: '1px solid #1e1e3a',
      borderRadius: 7, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Item */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <svg width={22} height={22} style={{ flexShrink: 0 }}>
          <use href={`${SPRITE_URL}#${toIconId(listing.mat_name)}`} width={22} height={22} />
        </svg>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#e0e0ff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {listing.mat_name}
        </span>
      </div>

      {/* Company */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {listing.company_logo && <CompanyLogo ic={listing.company_logo} size={15} />}
        <span style={{ fontSize: 13, color: '#c8c8e8', fontWeight: 600, lineHeight: 1.2 }}>
          {listing.guild_tag && <span style={{ color: '#8080b0', marginRight: 4 }}>[{listing.guild_tag}]</span>}
          {listing.company_name}
        </span>
      </div>

      {/* Price */}
      <div style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.02em' }}>
        {fmtPrice(listing.price_type, listing.price_value)}
      </div>

      {/* Stock + location */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {listing.stock_level && (
          <span style={{ fontSize: 11, color: STOCK_COLORS[listing.stock_level] ?? '#b0b0cc' }}>
            {STOCK_LABELS[listing.stock_level] ?? listing.stock_level} stock
          </span>
        )}
        {listing.location && (
          <span style={{ fontSize: 11, color: '#5a5a7a' }}>{listing.location}</span>
        )}
      </div>

      {/* Footer */}
      <div style={{ fontSize: 11, color: '#3a3a5a', marginTop: 'auto' }}>
        {relTime(listing.created_at)}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PRICE_TYPE_OPTIONS = [
  { label: 'Fixed',     val: 'fixed' },
  { label: 'Market −N', val: 'market_offset' },
  { label: 'Average',   val: 'average' },
];

const STOCK_OPTIONS = [
  { label: 'High',     val: 'high' },
  { label: 'Low',      val: 'low' },
  { label: 'To Order', val: 'to_order' },
];

export default function Trade() {
  const { user } = useAuth();

  const [listings,   setListings]   = useState([]);
  const [allItems,   setAllItems]   = useState([]);
  const [planets,    setPlanets]    = useState(['Exchange Station']);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState('');
  const [formOpen,   setFormOpen]   = useState(false);

  // Form state
  const [selItem,      setSelItem]      = useState(null);
  const [priceType,    setPriceType]    = useState('fixed');
  const [priceRaw,     setPriceRaw]     = useState('');
  const [priceErr,     setPriceErr]     = useState('');
  const [stockLevel,   setStockLevel]   = useState('high');
  const [atExchange,   setAtExchange]   = useState(true);
  const [planet,       setPlanet]       = useState('');
  const [planetSearch, setPlanetSearch] = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [submitErr,    setSubmitErr]    = useState('');
  const [deletingId,   setDeletingId]   = useState(null);
  const [editingId,    setEditingId]    = useState(null);
  const [editForm,     setEditForm]     = useState({});

  useEffect(() => {
    Promise.all([api.tradeListings(), api.allItems(), api.gamedata()])
      .then(([ls, items, gd]) => {
        setListings(ls);
        setAllItems(items);
        const names = (gd?.systems ?? [])
          .flatMap((s) => s.planets ?? [])
          .map((p) => p.name)
          .filter(Boolean)
          .sort();
        if (!names.includes('Exchange Station')) names.unshift('Exchange Station');
        setPlanets(names);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setSelItem(null);
    setPriceType('fixed');
    setPriceRaw('');
    setPriceErr('');
    setStockLevel('high');
    setAtExchange(true);
    setPlanet('');
    setPlanetSearch('');
    setSubmitErr('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setPriceErr('');
    setSubmitErr('');
    if (!selItem) return setSubmitErr('Please select an item.');

    let price_value = 0;
    if (priceType === 'fixed') {
      if (!/^\d+$/.test(priceRaw.trim())) { setPriceErr('Enter a whole number'); return; }
      price_value = parseInt(priceRaw.trim(), 10);
    } else if (priceType === 'market_offset') {
      if (!/^\d+$/.test(priceRaw.trim())) { setPriceErr('Enter the offset number e.g. 1'); return; }
      price_value = -parseInt(priceRaw.trim(), 10);
    }

    const location = buildLocation(atExchange, planet);
    if (!location) return setSubmitErr('Select a location');

    setSubmitting(true);
    try {
      const row = await api.tradeAdd({
        mat_id:      selItem.matId,
        mat_name:    selItem.matName,
        price_type:  priceType,
        price_value,
        stock_level: stockLevel,
        location,
      });
      setListings((prev) => [row, ...prev]);
      resetForm();
      setFormOpen(false);
    } catch (e) {
      setSubmitErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      await api.tradeDelete(id);
      setListings((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(l) {
    let priceRaw = '';
    if (l.price_type === 'fixed') priceRaw = String(l.price_value);
    else if (l.price_type === 'market_offset') priceRaw = String(Math.abs(l.price_value));

    let atExchange = false, planet = '', planetSearch = '';
    if (l.location) {
      if (l.location.startsWith('Exchange Station')) atExchange = true;
      const rest = l.location.replace('Exchange Station, ', '').replace('Exchange Station', '').trim();
      if (rest) { planet = rest; planetSearch = rest; }
    }
    setEditForm({ priceType: l.price_type, priceRaw, priceErr: '', stockLevel: l.stock_level || 'high', atExchange, planet, planetSearch });
    setEditingId(l.id);
  }

  async function handleUpdate(id) {
    const { priceType, priceRaw, stockLevel, atExchange, planet } = editForm;
    let price_value = 0;
    if (priceType === 'fixed') {
      if (!/^\d+$/.test(priceRaw.trim())) { setEditForm((f) => ({ ...f, priceErr: 'Enter a whole number' })); return; }
      price_value = parseInt(priceRaw.trim(), 10);
    } else if (priceType === 'market_offset') {
      if (!/^\d+$/.test(priceRaw.trim())) { setEditForm((f) => ({ ...f, priceErr: 'Enter the offset e.g. 1' })); return; }
      price_value = -parseInt(priceRaw.trim(), 10);
    }
    const location = buildLocation(atExchange, planet);
    if (!location) { setEditForm((f) => ({ ...f, priceErr: 'Select a location' })); return; }

    setSubmitting(true);
    try {
      const updated = await api.tradeUpdate(id, { price_type: priceType, price_value, stock_level: stockLevel, location });
      setListings((prev) => prev.map((l) => l.id === id ? { ...l, ...updated } : l));
      setEditingId(null);
    } catch (e) {
      setEditForm((f) => ({ ...f, priceErr: e.message }));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>;

  const guildTag = listings[0]?.guild_tag ?? user?.companyTag ?? '';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20, color: '#d8d8f0', fontWeight: 600 }}>Guild Trade Board</h2>
            {guildTag && (
              <span style={{
                padding: '2px 8px', background: '#1e1e3a', border: '1px solid #3a3a5a',
                borderRadius: 4, fontSize: 11, color: '#8080aa', fontWeight: 600, letterSpacing: 1,
              }}>{guildTag}</span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a5a7a' }}>
            Internal guild pricing — visible to guild members only
          </p>
        </div>
        <button
          onClick={() => { setFormOpen((o) => !o); if (formOpen) resetForm(); }}
          style={{
            marginLeft: 'auto', padding: '7px 14px',
            background: formOpen ? '#1e1e3a' : '#3730a3',
            border: '1px solid ' + (formOpen ? '#3a3a5a' : '#4f46e5'),
            borderRadius: 6, color: '#d8d8f0', fontSize: 13, cursor: 'pointer',
          }}
        >{formOpen ? '✕ Cancel' : '+ Add Listing'}</button>
      </div>

      {/* Add listing form */}
      {formOpen && (
        <form onSubmit={handleSubmit} style={{
          marginBottom: 20, padding: '16px',
          background: '#0d0d1f', border: '1px solid #2a2a4a', borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {/* Row 1: Item */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item</label>
            {selItem ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                background: '#0d0d1f', border: '1px solid #3730a3', borderRadius: 6, cursor: 'pointer',
              }} onClick={() => setSelItem(null)}>
                <svg width={18} height={18} style={{ flexShrink: 0 }}>
                  <use href={`${SPRITE_URL}#${toIconId(selItem.matName)}`} width={18} height={18} />
                </svg>
                <span style={{ fontSize: 13, color: '#d8d8f0', flex: 1 }}>{selItem.matName}</span>
                <span style={{ fontSize: 11, color: '#5a5a7a' }}>✕</span>
              </div>
            ) : (
              <ItemSearch items={allItems} onSelect={(item) => setSelItem({ matId: item.matId, matName: item.matName })} />
            )}
          </div>

          {/* Row 2: Price + Stock */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '2 1 200px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Price</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <ToggleGroup options={PRICE_TYPE_OPTIONS} value={priceType} onChange={(v) => { setPriceType(v); setPriceRaw(''); setPriceErr(''); }} />
                {priceType !== 'average' && (
                  <div>
                    <input
                      value={priceRaw}
                      onChange={(e) => { setPriceRaw(e.target.value); setPriceErr(''); }}
                      placeholder={priceType === 'fixed' ? 'e.g. 1650' : 'e.g. 1 (for Market −1)'}
                      style={{
                        width: '100%', padding: '7px 10px', background: '#0d0d1f',
                        border: '1px solid ' + (priceErr ? '#ef4444' : '#2a2a4a'),
                        borderRadius: 6, color: '#d8d8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    {priceErr && <span style={{ fontSize: 11, color: '#ef4444' }}>{priceErr}</span>}
                  </div>
                )}
              </div>
            </div>

            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stock</label>
              <ToggleGroup options={STOCK_OPTIONS} value={stockLevel} onChange={setStockLevel} />
            </div>
          </div>

          {/* Row 3: Location */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Location</label>
            <LocationPicker
              planets={planets}
              atExchange={atExchange} setAtExchange={setAtExchange}
              planet={planet} setPlanet={setPlanet}
              planetSearch={planetSearch} setPlanetSearch={setPlanetSearch}
            />
          </div>

          {/* Row 4: Submit */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            {submitErr && <span style={{ fontSize: 12, color: '#ef4444' }}>{submitErr}</span>}
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '7px 20px', background: '#3730a3', border: '1px solid #4f46e5',
                borderRadius: 6, color: '#d8d8f0', fontSize: 13,
                cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1,
              }}
            >{submitting ? 'Listing…' : 'List Item'}</button>
          </div>
        </form>
      )}

      {/* Error */}
      {err && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 6, color: '#fca5a5', fontSize: 13 }}>
          {err}
        </div>
      )}

      {/* Listings */}
      {listings.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#4a4a6a', fontSize: 14 }}>
          No guild listings yet. Be the first to add one.
        </div>
      ) : (() => {
        const own   = listings.filter((l) => l.user_id === user?.id);
        const guild = listings;
        return (
          <>
            {/* Your listings */}
            {own.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Your Listings
                </div>
                <div style={{ border: '1px solid #1e1e3a', borderRadius: 7, overflow: 'hidden' }}>
                  {own.map((l, i) => (
                    <div key={l.id} style={{
                      borderBottom: i < own.length - 1 ? '1px solid #12122a' : 'none',
                      background: editingId === l.id ? '#0f0f28' : '#0d0d1f',
                    }}>
                      {editingId === l.id ? (
                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {/* Item header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <svg width={16} height={16} style={{ flexShrink: 0 }}>
                              <use href={`${SPRITE_URL}#${toIconId(l.mat_name)}`} width={16} height={16} />
                            </svg>
                            <span style={{ fontSize: 13, color: '#d8d8f0', flex: 1 }}>{l.mat_name}</span>
                            <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: 'pointer', fontSize: 12, padding: 0 }}>Cancel</button>
                          </div>
                          {/* Price */}
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <div style={{ flex: '2 1 160px' }}>
                              <div style={{ fontSize: 10, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Price</div>
                              <ToggleGroup options={PRICE_TYPE_OPTIONS} value={editForm.priceType} onChange={(v) => setEditForm((f) => ({ ...f, priceType: v, priceRaw: '', priceErr: '' }))} />
                              {editForm.priceType !== 'average' && (
                                <input
                                  value={editForm.priceRaw}
                                  onChange={(e) => setEditForm((f) => ({ ...f, priceRaw: e.target.value, priceErr: '' }))}
                                  placeholder={editForm.priceType === 'fixed' ? 'e.g. 1650' : 'e.g. 1'}
                                  style={{ marginTop: 6, width: '100%', padding: '6px 8px', background: '#0d0d1f', border: '1px solid #2a2a4a', borderRadius: 5, color: '#d8d8f0', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                                />
                              )}
                            </div>
                            <div style={{ flex: '1 1 140px' }}>
                              <div style={{ fontSize: 10, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Stock</div>
                              <ToggleGroup options={STOCK_OPTIONS} value={editForm.stockLevel} onChange={(v) => setEditForm((f) => ({ ...f, stockLevel: v }))} />
                            </div>
                          </div>
                          {/* Location */}
                          <div>
                            <div style={{ fontSize: 10, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Location</div>
                            <LocationPicker
                              planets={planets}
                              atExchange={editForm.atExchange} setAtExchange={(v) => setEditForm((f) => ({ ...f, atExchange: v }))}
                              planet={editForm.planet} setPlanet={(v) => setEditForm((f) => ({ ...f, planet: v }))}
                              planetSearch={editForm.planetSearch} setPlanetSearch={(v) => setEditForm((f) => ({ ...f, planetSearch: v }))}
                            />
                          </div>
                          {/* Save */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                            {editForm.priceErr && <span style={{ fontSize: 11, color: '#ef4444' }}>{editForm.priceErr}</span>}
                            <button
                              onClick={() => handleUpdate(l.id)}
                              disabled={submitting}
                              style={{ padding: '6px 16px', background: '#3730a3', border: '1px solid #4f46e5', borderRadius: 5, color: '#d8d8f0', fontSize: 12, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}
                            >Save</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
                          <svg width={18} height={18} style={{ flexShrink: 0 }}>
                            <use href={`${SPRITE_URL}#${toIconId(l.mat_name)}`} width={18} height={18} />
                          </svg>
                          <span style={{ fontSize: 13, color: '#d8d8f0', flex: 1 }}>{l.mat_name}</span>
                          {l.stock_level && (
                            <span style={{ fontSize: 11, color: STOCK_COLORS[l.stock_level], whiteSpace: 'nowrap' }}>
                              {STOCK_LABELS[l.stock_level]}
                            </span>
                          )}
                          {l.location && (
                            <span style={{ fontSize: 11, color: '#4a4a6a', whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {l.location}
                            </span>
                          )}
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap' }}>
                            {fmtPrice(l.price_type, l.price_value)}
                          </span>
                          <span style={{ fontSize: 11, color: '#3a3a5a', whiteSpace: 'nowrap' }}>{relTime(l.created_at)}</span>
                          <button
                            onClick={() => startEdit(l)}
                            style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: 'pointer', fontSize: 11, padding: '0 2px', flexShrink: 0 }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#4a4a6a'; }}
                          >Edit</button>
                          <button
                            onClick={() => handleDelete(l.id)}
                            disabled={deletingId === l.id}
                            style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: deletingId === l.id ? 'default' : 'pointer', fontSize: 13, padding: '0 2px', opacity: deletingId === l.id ? 0.4 : 1, flexShrink: 0 }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#4a4a6a'; }}
                          >✕</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Guild members' listings */}
            {guild.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Guild Listings
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                  {guild.map((l) => <ListingCard key={l.id} listing={l} />)}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
