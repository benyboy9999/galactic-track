import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { toIconId } from '../utils/materialIcon';

const SPRITE_URL = '/api/gamedata/sprite';

// ── Company logo decoder ───────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────────

const STOCK_LABELS = { high: 'High', low: 'Low', to_order: 'To Order' };
const STOCK_COLORS = { high: '#22c55e', low: '#f59e0b', to_order: '#a78bfa' };

function fmtPrice(type, value) {
  if (type === 'fixed')   return Number(value).toLocaleString();
  if (type === 'average') return 'Avg';
  return `Market ${Number(value)}`;
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


const DEFAULT_LOC_FORM = {
  priceType: 'fixed', priceRaw: '', priceErr: '',
  stockLevel: 'high', planet: 'Exchange Station', planetSearch: 'Exchange Station',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

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

function LocationPicker({ planets, planet, setPlanet, planetSearch, setPlanetSearch }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text" value={planetSearch} placeholder="Search location…"
        onChange={(e) => { setPlanetSearch(e.target.value); setPlanet(''); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        style={{
          width: '100%', boxSizing: 'border-box', background: '#0d0d1f',
          border: `1px solid ${planet ? '#4c1d95' : '#2a2a4a'}`, borderRadius: 5,
          padding: '7px 10px', color: '#e0e0ff', fontSize: 12, outline: 'none',
        }}
      />
      {focused && !planet && (() => {
        const q = planetSearch.toLowerCase();
        const matches = planets.filter((p) => p.toLowerCase().includes(q)).slice(0, 12);
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
      {!planet && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171' }}>Select a location</p>}
    </div>
  );
}

// ── Location form (shared between add and edit) ────────────────────────────────

function LocationForm({ form, setForm, planets, onSubmit, onCancel, submitting, label }) {
  return (
    <div style={{ padding: '8px 12px', background: '#0a0a1a', borderTop: '1px solid #1a1a35' }}>
      {/* Row 1: price type + value + stock all inline */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <ToggleGroup
          options={PRICE_TYPE_OPTIONS}
          value={form.priceType}
          onChange={(v) => setForm((f) => ({ ...f, priceType: v, priceRaw: '', priceErr: '' }))}
        />
        {form.priceType !== 'average' && (
          <input
            value={form.priceRaw}
            onChange={(e) => setForm((f) => ({ ...f, priceRaw: e.target.value, priceErr: '' }))}
            placeholder={form.priceType === 'fixed' ? 'e.g. 1650' : 'offset e.g. 1'}
            style={{
              width: 100, padding: '5px 8px', background: '#0d0d1f',
              border: `1px solid ${form.priceErr ? '#ef4444' : '#2a2a4a'}`,
              borderRadius: 5, color: '#d8d8f0', fontSize: 12, outline: 'none',
            }}
          />
        )}
        <ToggleGroup
          options={STOCK_OPTIONS}
          value={form.stockLevel}
          onChange={(v) => setForm((f) => ({ ...f, stockLevel: v }))}
        />
      </div>
      {/* Row 2: location + action buttons inline */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div style={{ width: 180, flexShrink: 0 }}>
          <LocationPicker
            planets={planets}
            planet={form.planet}
            setPlanet={(v) => setForm((f) => ({ ...f, planet: v }))}
            planetSearch={form.planetSearch}
            setPlanetSearch={(v) => setForm((f) => ({ ...f, planetSearch: v }))}
          />
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 12, padding: '7px 6px', whiteSpace: 'nowrap', flexShrink: 0 }}
          >Cancel</button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          style={{
            padding: '6px 14px', background: '#3730a3', border: '1px solid #4f46e5',
            borderRadius: 5, color: '#d8d8f0', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0,
            cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1,
          }}
        >{label}</button>
      </div>
      {form.priceErr && <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>{form.priceErr}</span>}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Main component ─────────────────────────────────────────────────────────────

export default function Trade() {
  const { user } = useAuth();

  const [listings,   setListings]   = useState([]);
  const [allItems,   setAllItems]   = useState([]);
  const [planets,    setPlanets]    = useState(['Exchange Station']);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState('');

  // Add-listing form
  const [formOpen,      setFormOpen]      = useState(false);
  const [selItem,       setSelItem]       = useState(null);
  const [pendingLocForm, setPendingLocForm] = useState({ ...DEFAULT_LOC_FORM });
  const [submitting,    setSubmitting]    = useState(false);
  const [submitErr,     setSubmitErr]     = useState('');
  const [deletingId,    setDeletingId]    = useState(null);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [expandedItem, setExpandedItem] = useState(null);

  // Location add/edit
  const [addingLocListingId, setAddingLocListingId] = useState(null); // listing id with open add form
  const [editingLoc,         setEditingLoc]         = useState(null); // { listingId, locId }
  const [locForm,            setLocForm]            = useState({ ...DEFAULT_LOC_FORM });

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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function parseLocForm(form) {
    const { priceType, priceRaw, stockLevel, planet } = form;
    let price_value = 0;
    if (priceType === 'fixed') {
      if (!/^\d+$/.test(priceRaw.trim())) return { err: 'Enter a whole number' };
      price_value = parseInt(priceRaw.trim(), 10);
    } else if (priceType === 'market_offset') {
      if (!/^\d+$/.test(priceRaw.trim())) return { err: 'Enter the offset e.g. 1' };
      price_value = -parseInt(priceRaw.trim(), 10);
    }
    if (!planet) return { err: 'Select a location' };
    return { price_type: priceType, price_value, stock_level: stockLevel, location: planet };
  }

  // ── Listing CRUD ─────────────────────────────────────────────────────────────

  async function handleCreateWithLocation() {
    if (!selItem) return;
    const parsed = parseLocForm(pendingLocForm);
    if (parsed.err) { setPendingLocForm((f) => ({ ...f, priceErr: parsed.err })); return; }
    setSubmitting(true);
    setSubmitErr('');
    try {
      const row = await api.tradeAdd({ mat_id: selItem.matId, mat_name: selItem.matName });
      const loc = await api.tradeAddLocation(row.id, parsed);
      setListings((prev) => [{ ...row, locations: [loc] }, ...prev]);
      setSelItem(null);
      setPendingLocForm({ ...DEFAULT_LOC_FORM });
      setFormOpen(false);
    } catch (e) {
      setSubmitErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    if (addingLocListingId === id) setAddingLocListingId(null);
    if (editingLoc?.listingId === id) setEditingLoc(null);
    try {
      await api.tradeDelete(id);
      setListings((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  // ── Location CRUD ────────────────────────────────────────────────────────────

  async function handleAddLocation(listingId) {
    const parsed = parseLocForm(locForm);
    if (parsed.err) { setLocForm((f) => ({ ...f, priceErr: parsed.err })); return; }
    setSubmitting(true);
    try {
      const loc = await api.tradeAddLocation(listingId, parsed);
      setListings((prev) => prev.map((l) =>
        l.id === listingId ? { ...l, locations: [...(l.locations ?? []), loc] } : l
      ));
      setAddingLocListingId(null);
    } catch (e) {
      setLocForm((f) => ({ ...f, priceErr: e.message }));
    } finally {
      setSubmitting(false);
    }
  }

  function startEditLoc(listingId, loc) {
    let priceRaw = '';
    if (loc.price_type === 'fixed') priceRaw = String(loc.price_value);
    else if (loc.price_type === 'market_offset') priceRaw = String(Math.abs(loc.price_value));
    const planet = loc.location || '';
    setLocForm({ priceType: loc.price_type, priceRaw, priceErr: '', stockLevel: loc.stock_level || 'high', planet, planetSearch: planet });
    setEditingLoc({ listingId, locId: loc.id });
    setAddingLocListingId(null);
  }

  async function handleUpdateLocation(listingId, locId) {
    const parsed = parseLocForm(locForm);
    if (parsed.err) { setLocForm((f) => ({ ...f, priceErr: parsed.err })); return; }
    setSubmitting(true);
    try {
      const updated = await api.tradeUpdateLocation(listingId, locId, parsed);
      setListings((prev) => prev.map((l) =>
        l.id === listingId
          ? { ...l, locations: l.locations.map((loc) => loc.id === locId ? updated : loc) }
          : l
      ));
      setEditingLoc(null);
    } catch (e) {
      setLocForm((f) => ({ ...f, priceErr: e.message }));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteLocation(listingId, locId) {
    try {
      const listing = listings.find((l) => l.id === listingId);
      const isLast = listing?.locations?.length === 1;
      await api.tradeDeleteLocation(listingId, locId);
      if (isLast) {
        await api.tradeDelete(listingId);
        if (addingLocListingId === listingId) setAddingLocListingId(null);
        if (editingLoc?.listingId === listingId) setEditingLoc(null);
        setListings((prev) => prev.filter((l) => l.id !== listingId));
      } else {
        setListings((prev) => prev.map((l) =>
          l.id === listingId ? { ...l, locations: l.locations.filter((loc) => loc.id !== locId) } : l
        ));
      }
    } catch (e) {
      setErr(e.message);
    }
  }

  // ── Ownership helper ─────────────────────────────────────────────────────────

  function checkOwn(l) {
    return l.user_id === user?.id ||
      (String(user?.companyId) === '0' && l.company_name === user?.companyName);
  }

  const myListings = useMemo(() => listings.filter(checkOwn), [listings, user]);

  // ── Grouped listings ─────────────────────────────────────────────────────────

  const groupedListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map();
    for (const l of listings) {
      if (!map.has(l.mat_id)) map.set(l.mat_id, { mat_id: l.mat_id, mat_name: l.mat_name, rows: [] });
      map.get(l.mat_id).rows.push(l);
    }
    let groups = Array.from(map.values());
    if (q) groups = groups.filter((g) => g.mat_name.toLowerCase().includes(q));
    groups.sort((a, b) => a.mat_name.localeCompare(b.mat_name));
    return groups;
  }, [listings, searchQuery]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>;

  const guildTag = listings[0]?.guild_tag ?? user?.companyTag ?? '';

  function toggleItem(matId) {
    setExpandedItem((prev) => prev === matId ? null : matId);
  }

  // ── Your Listings column renderer ─────────────────────────────────────────────

  function renderMyListing(l) {
    return (
      <div key={l.id} style={{ borderTop: '1px solid #1a1a35' }}>
        {/* Item header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: '#0d0d22' }}>
          <svg width={16} height={16} style={{ flexShrink: 0 }}>
            <use href={`${SPRITE_URL}#${toIconId(l.mat_name)}`} width={16} height={16} />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#d8d8f0', flex: 1 }}>{l.mat_name}</span>
          <button
            onClick={() => { setLocForm({ ...DEFAULT_LOC_FORM }); setAddingLocListingId(addingLocListingId === l.id ? null : l.id); setEditingLoc(null); }}
            style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#4a4a6a'; }}
          >+ Location</button>
          <button
            onClick={() => handleDelete(l.id)}
            disabled={deletingId === l.id}
            style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: deletingId === l.id ? 'default' : 'pointer', fontSize: 13, padding: '0 2px', opacity: deletingId === l.id ? 0.4 : 1 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#4a4a6a'; }}
            title="Remove listing"
          >✕</button>
        </div>
        {/* Location rows */}
        {(l.locations ?? []).map((loc) => (
          <div key={loc.id}>
            {editingLoc?.listingId === l.id && editingLoc?.locId === loc.id ? (
              <LocationForm
                form={locForm}
                setForm={setLocForm}
                planets={planets}
                onSubmit={() => handleUpdateLocation(l.id, loc.id)}
                onCancel={() => setEditingLoc(null)}
                submitting={submitting}
                label="Save"
              />
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 12px 4px 28px', background: '#0a0a1e',
                borderTop: '1px solid #0e0e22',
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', minWidth: 50 }}>
                  {fmtPrice(loc.price_type, loc.price_value)}
                </span>
                {loc.stock_level && (
                  <span style={{ fontSize: 11, color: STOCK_COLORS[loc.stock_level], whiteSpace: 'nowrap' }}>
                    {STOCK_LABELS[loc.stock_level]}
                  </span>
                )}
                {loc.location && (
                  <span style={{ fontSize: 11, color: '#4a4a6a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {loc.location}
                  </span>
                )}
                <button
                  onClick={() => startEditLoc(l.id, loc)}
                  style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#4a4a6a'; }}
                >Edit</button>
                <button
                  onClick={() => handleDeleteLocation(l.id, loc.id)}
                  style={{ background: 'none', border: 'none', color: '#4a4a6a', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#4a4a6a'; }}
                >✕</button>
              </div>
            )}
          </div>
        ))}
        {/* Add location form */}
        {addingLocListingId === l.id && (
          <LocationForm
            form={locForm}
            setForm={setLocForm}
            planets={planets}
            onSubmit={() => handleAddLocation(l.id)}
            onCancel={() => setAddingLocListingId(null)}
            submitting={submitting}
            label="Add Location"
          />
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e0e0f0' }}>Guild Trade Board</h1>
            {guildTag && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', background: '#1e1440', border: '1px solid #4c1d95', borderRadius: 4, padding: '1px 7px', letterSpacing: '0.05em' }}>
                {guildTag}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6b6b8a', marginTop: 2 }}>Internal guild pricing system — Currently exclusive for ATS members.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href="https://galactic-track.com/extension"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', background: '#1e1440',
              border: '1px solid #4c1d95', borderRadius: 6,
              color: '#a78bfa', fontSize: 12, fontWeight: 600,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#2d1f5e'; e.currentTarget.style.borderColor = '#6d28d9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#1e1440'; e.currentTarget.style.borderColor = '#4c1d95'; }}
          >
            ⚙️ View Guild Prices In-Game — Get Chrome Extension
          </a>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items…"
            style={{
              width: 200, boxSizing: 'border-box', padding: '6px 10px',
              background: '#13132a', border: '1px solid #1e1e3a', borderRadius: 6,
              color: '#d8d8f0', fontSize: 12, outline: 'none',
            }}
          />
          <button
            onClick={() => { setFormOpen((o) => !o); if (formOpen) { setSelItem(null); setPendingLocForm({ ...DEFAULT_LOC_FORM }); setSubmitErr(''); } }}
            style={{
              padding: '6px 14px',
              background: formOpen ? '#13132a' : '#1e1440',
              border: `1px solid ${formOpen ? '#2e2e5a' : '#4c1d95'}`,
              borderRadius: 6,
              color: formOpen ? '#6b6b8a' : '#a78bfa',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >{formOpen ? '✕ Cancel' : '+ Post Listing'}</button>
        </div>
      </div>

      {/* Post listing form */}
      {formOpen && (
        <div style={{ marginBottom: 20, background: '#0d0d1f', border: '1px solid #2e2e5a', borderRadius: 8 }}>
          {selItem ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              <div style={{ padding: '12px 14px', borderRight: '1px solid #1a1a2e' }}>
                <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item</label>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#0d0d1f', border: '1px solid #4c1d95', borderRadius: 6, cursor: 'pointer' }}
                  onClick={() => { setSelItem(null); setPendingLocForm({ ...DEFAULT_LOC_FORM }); }}
                >
                  <svg width={18} height={18} style={{ flexShrink: 0 }}>
                    <use href={`${SPRITE_URL}#${toIconId(selItem.matName)}`} width={18} height={18} />
                  </svg>
                  <span style={{ fontSize: 13, color: '#d8d8f0', flex: 1 }}>{selItem.matName}</span>
                  <span style={{ fontSize: 11, color: '#5a5a7a' }}>✕</span>
                </div>
                {submitErr && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{submitErr}</div>}
              </div>
              <div>
                <LocationForm
                  form={pendingLocForm}
                  setForm={setPendingLocForm}
                  planets={planets}
                  onSubmit={handleCreateWithLocation}
                  onCancel={null}
                  submitting={submitting}
                  label={submitting ? 'Posting…' : 'Post Listing'}
                />
              </div>
            </div>
          ) : (
            <div style={{ padding: '12px 14px' }}>
              <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item</label>
              <ItemSearch items={allItems} onSelect={(item) => setSelItem({ matId: item.matId, matName: item.matName })} />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {err && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 6, color: '#fca5a5', fontSize: 13 }}>
          {err}
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 16, alignItems: 'start' }}>

        {/* Left — Guild Listings */}
        <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a35' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Guild Listings</span>
          </div>
          {listings.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#4a4a6a', fontSize: 14 }}>
              No guild listings yet. Be the first to post one.
            </div>
          ) : groupedListings.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#4a4a6a', fontSize: 14 }}>
              No items match "{searchQuery}"
            </div>
          ) : (
            <div>
              {groupedListings.map((group, gi) => {
                const isExpanded = expandedItem === group.mat_id;
                const allLocs = group.rows.flatMap((r) => r.locations ?? []);
                const fixed = allLocs.filter((l) => l.price_type !== 'average');
                const bestLoc = (fixed.length ? fixed : allLocs).reduce(
                  (a, b) => a && a.price_value <= b.price_value ? a : b, null
                );

                return (
                  <div key={group.mat_id}>
                    {/* Item row */}
                    <div
                      onClick={() => toggleItem(group.mat_id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 14px', cursor: 'pointer',
                        background: isExpanded ? '#0f0f2a' : '#0d0d22',
                        borderTop: gi > 0 ? '1px solid #1a1a35' : 'none',
                      }}
                      onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = '#0f0f2a'; }}
                      onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = '#0d0d22'; }}
                    >
                      <svg width={18} height={18} style={{ flexShrink: 0 }}>
                        <use href={`${SPRITE_URL}#${toIconId(group.mat_name)}`} width={18} height={18} />
                      </svg>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#d8d8f0', flex: 1 }}>{group.mat_name}</span>
                      {bestLoc && (
                        <span style={{ fontSize: 13, color: '#c0c0e0', fontWeight: 500, marginRight: 8 }}>
                          {fmtPrice(bestLoc.price_type, bestLoc.price_value)}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#4a4a6a', marginRight: 8 }}>
                        {group.rows.length} {group.rows.length === 1 ? 'seller' : 'sellers'}
                      </span>
                      <span style={{ fontSize: 12, color: '#4a4a6a', transition: 'transform 0.15s', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>›</span>
                    </div>

                    {/* Expanded: sellers + locations */}
                    {isExpanded && group.rows.map((l) => {
                      const isOwn = checkOwn(l);
                      return (
                        <div key={l.id}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 14px 6px 40px', background: '#0a0a1e',
                            borderTop: '1px solid #12122a',
                          }}>
                            {l.company_logo && <CompanyLogo ic={l.company_logo} size={14} />}
                            <span style={{ fontSize: 12, color: '#a0a0c8', fontWeight: 600, flex: 1 }}>
                              {l.guild_tag && <span style={{ color: '#5a5a90', marginRight: 4 }}>[{l.guild_tag}]</span>}
                              {l.company_name}
                            </span>
                            <span style={{ fontSize: 11, color: '#3a3a5a' }}>{relTime(l.created_at)}</span>
                          </div>

                          {/* Location rows */}
                          {(l.locations ?? []).map((loc) => (
                            <div key={loc.id}>
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '4px 14px 4px 56px', background: '#080818',
                                borderTop: '1px solid #0e0e22',
                              }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', minWidth: 55 }}>
                                  {fmtPrice(loc.price_type, loc.price_value)}
                                </span>
                                {loc.stock_level && (
                                  <span style={{ fontSize: 11, color: STOCK_COLORS[loc.stock_level], whiteSpace: 'nowrap' }}>
                                    {STOCK_LABELS[loc.stock_level]}
                                  </span>
                                )}
                                {loc.location && (
                                  <span style={{ fontSize: 11, color: '#4a4a6a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {loc.location}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right — Your Listings */}
        <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a35', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your Listings</span>
            {myListings.length > 0 && (
              <span style={{ fontSize: 11, color: '#3a3a5a' }}>{myListings.length}</span>
            )}
          </div>
          {myListings.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: '#3a3a5a', fontSize: 12 }}>
              No listings yet
            </div>
          ) : (
            myListings.map((l) => renderMyListing(l))
          )}
        </div>

      </div>
    </div>
  );
}
