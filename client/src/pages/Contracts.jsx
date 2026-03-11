import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { toIconId } from '../utils/materialIcon';

// 20-colour palette used by Galactic Tycoons company logos
const LOGO_PALETTE = [
  '#db1a1a', '#c34b22', '#f68055', '#f2740d', '#f2ad0d',
  '#e4e40c', '#99da0b', '#0ac20a', '#10c16e', '#0bd0d0',
  '#93ceec', '#0da6f2', '#256af4', '#734dff', '#b399e6',
  '#9933ff', '#dd3cdd', '#eb477e', '#f0a8c0', '#cccccc',
];

function decodeCompanyLogo(ic) {
  try {
    // Handle URL-safe base64
    const normalized = ic.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length !== 8) return null;
    // 49 pixels, LSB first
    const pixels = Array.from({ length: 7 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => {
        const i = r * 7 + c;
        return ((bytes[Math.floor(i / 8)] >> (i % 8)) & 1) === 1;
      })
    );
    // Color: low 6 bits of byte 6; upper 5 bits are swatch index
    const colorCode = bytes[6] & 0x3f;
    const swatchIndex = Math.max(0, Math.min(LOGO_PALETTE.length - 1, colorCode >> 1));
    return { pixels, color: LOGO_PALETTE[swatchIndex] };
  } catch { return null; }
}

function CompanyLogo({ ic, size = 28 }) {
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

const SPRITE_URL = '/api/gamedata/sprite';


function fmtAgo(iso) {
  if (!iso) return '—';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 120)   return `${Math.floor(sec)}s ago`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function TypeBadge({ type }) {
  const isBuy = type === 'buy';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 4,
      color: isBuy ? '#34d399' : '#f87171',
      background: isBuy ? '#0a1f18' : '#1f0a0a',
      border: `1px solid ${isBuy ? '#065f46' : '#7f1d1d'}`,
    }}>
      {isBuy ? 'Looking to Buy' : 'Looking to Sell'}
    </span>
  );
}

function BumpButton({ contract, actioning, onBump, compact = false }) {
  const isActioning = actioning?.id === contract.id && actioning?.type === 'bump';
  const bumpedAt = contract.bumped_at ? new Date(contract.bumped_at) : null;
  const cooldownMs = bumpedAt ? (bumpedAt.getTime() + 3_600_000) - Date.now() : 0;
  const onCooldown = cooldownMs > 0;
  const cooldownStr = onCooldown ? (() => {
    const m = Math.ceil(cooldownMs / 60_000);
    return m >= 60 ? `${Math.ceil(m / 60)}h` : `${m}m`;
  })() : null;

  return (
    <button
      onClick={() => !onCooldown && !isActioning && onBump(contract.id)}
      disabled={onCooldown || isActioning}
      title={onCooldown ? `Bump available in ${cooldownStr}` : 'Move to top of listings & reset 7-day expiry'}
      style={{
        ...(compact ? { width: 64 } : { flex: 1 }),
        background: 'none',
        border: `1px solid ${onCooldown ? '#2e2e5a' : '#1e3a2a'}`,
        borderRadius: 4, padding: '4px 0',
        color: onCooldown ? '#3a3a55' : '#34d399',
        fontSize: 11, cursor: onCooldown || isActioning ? 'not-allowed' : 'pointer',
        opacity: isActioning ? 0.5 : 1,
      }}
    >
      {isActioning ? '…' : onCooldown ? `Bump ${cooldownStr}` : 'Bump'}
    </button>
  );
}

function MyListingCard({ contract, deleting, actioning, onCancel, onEdit, onBump }) {
  const isCancelling = deleting === contract.id;
  const busy = isCancelling || !!actioning;
  const interests = contract.interests ?? [];

  return (
    <div style={{
      background: '#0d0d1a', border: '1px solid #2e2e5a', borderRadius: 7,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="18" height="18" style={{ flexShrink: 0 }}>
          <use href={`${SPRITE_URL}#${toIconId(contract.mat_name)}`} width="18" height="18" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0ff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.mat_name}</span>
        <TypeBadge type={contract.type} />
      </div>

      <div style={{ fontSize: 11, color: '#7070a0' }}>
        {contract.planet} · {Number(contract.max_daily_qty).toLocaleString()}/day · {fmtAgo(contract.bumped_at ?? contract.created_at)}
      </div>

      {interests.length > 0 && (
        <div style={{ borderTop: '1px solid #1e1e3a', paddingTop: 6 }}>
          <div style={{ fontSize: 10, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Interested ({interests.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {interests.map((name) => (
              <span key={name} style={{ fontSize: 11, color: '#a78bfa' }}>{name}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 5 }}>
        <BumpButton contract={contract} actioning={actioning} onBump={onBump} />
        <button
          onClick={() => !busy && onEdit(contract)}
          disabled={busy}
          style={{
            flex: 1, background: 'none', border: '1px solid #1e2e4a',
            borderRadius: 4, padding: '3px 0', color: '#60a5fa',
            fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
          }}
        >Edit</button>
        <button
          onClick={() => !busy && onCancel(contract.id)}
          disabled={busy}
          style={{
            flex: 1, background: 'none', border: '1px solid #2e1a1a',
            borderRadius: 4, padding: '3px 0', color: '#7f1d1d',
            fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer', opacity: isCancelling ? 0.5 : 1,
          }}
        >{isCancelling ? '…' : 'Remove'}</button>
      </div>
    </div>
  );
}

// Module-level timestamp so feedback is debounced across all cards
let lastFeedbackAt = 0;

function ContractCard({ contract, isOwn }) {
  const [interested,   setInterested]   = useState(contract.i_am_interested ?? false);
  const [loading,      setLoading]      = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  async function toggleInterest() {
    if (loading) return;
    setLoading(true);
    try {
      if (interested) {
        await api.removeInterest(contract.id);
        setInterested(false);
      } else {
        await api.markInterest(contract.id);
        setInterested(true);
        const now = Date.now();
        if (now - lastFeedbackAt > 10_000) {
          lastFeedbackAt = now;
          setShowFeedback(true);
          setTimeout(() => setShowFeedback(false), 6_000);
        }
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  const onlineDot = (() => {
    if (!contract.last_seen) return { color: '#3a3a55', label: 'Last seen: unknown' };
    const ageSec = (Date.now() - new Date(contract.last_seen).getTime()) / 1000;
    if (ageSec < 300)   return { color: '#10b981', label: `Online · last seen ${fmtAgo(contract.last_seen)}` };
    if (ageSec < 86400) return { color: '#fbbf24', label: `Last seen ${fmtAgo(contract.last_seen)}` };
    return { color: '#f87171', label: `Last seen ${fmtAgo(contract.last_seen)}` };
  })();

  return (
    <div id={`contract-${contract.id}`} style={{
      background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 7,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      {/* Badge row */}
      <div><TypeBadge type={contract.type} /></div>

      {/* Icon + item — main header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <svg width="24" height="24" style={{ flexShrink: 0 }}>
          <use href={`${SPRITE_URL}#${toIconId(contract.mat_name)}`} width="24" height="24" />
        </svg>
        <span style={{ fontSize: 17, fontWeight: 700, color: '#e0e0ff' }}>
          {contract.mat_name}
        </span>
      </div>

      {/* Company logo + name + online indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span title={onlineDot.label} style={{ color: onlineDot.color, fontSize: 10, flexShrink: 0 }}>●</span>
        {contract.company_logo && <CompanyLogo ic={contract.company_logo} size={15} />}
        <div style={{ fontSize: 14, fontWeight: 700, color: '#c8c8e8', lineHeight: 1.3 }}>
          {contract.company_tag && (
            <span style={{ color: '#8080b0', marginRight: 4 }}>
              [{contract.company_tag}]
            </span>
          )}
          {contract.company_name}
        </div>
      </div>

      {/* Location · qty · time */}
      <div style={{ fontSize: 11, color: '#7070a0' }}>
        {contract.planet} · {Number(contract.max_daily_qty).toLocaleString()}/day · {fmtAgo(contract.bumped_at ?? contract.created_at)}
      </div>

      {/* Interest button — hidden on own listings */}
      {!isOwn && (
        <>
          <button
            onClick={toggleInterest}
            disabled={loading}
            style={{
              background: interested ? '#1a1040' : 'none',
              border: `1px solid ${interested ? '#6d28d9' : '#2e2e5a'}`,
              borderRadius: 4, padding: '4px 0',
              color: interested ? '#a78bfa' : '#4a4a7a',
              fontSize: 11, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1, width: '100%',
            }}
          >
            {loading ? '…' : interested ? '★ Interested' : '☆ Mark as interested'}
          </button>
          {showFeedback && (
            <div style={{ fontSize: 11, color: '#6b9e6b', background: '#0a1a0a', border: '1px solid #1a3a1a', borderRadius: 4, padding: '5px 8px', lineHeight: 1.4 }}>
              {contract.company_name} has been notified — reach out to them in-game to negotiate!
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Filter typeahead ──────────────────────────────────────────────────────────

function FilterTypeahead({ options, value, onChange, placeholder }) {
  const [search,  setSearch]  = useState(value);
  const [focused, setFocused] = useState(false);

  // Keep display in sync if parent clears value externally
  useEffect(() => { if (!value) setSearch(''); }, [value]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || value) return [];
    return options.filter((o) => o.toLowerCase().includes(q)).slice(0, 14);
  }, [options, search, value]);

  function select(opt) {
    setSearch(opt);
    onChange(opt);
  }

  function clear() {
    setSearch('');
    onChange('');
  }

  const active = !!value;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type="text"
          placeholder={placeholder}
          value={search}
          onChange={(e) => { setSearch(e.target.value); if (!e.target.value) onChange(''); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          style={{
            background: active ? '#1e1440' : '#13132a',
            border: `1px solid ${active ? '#7c3aed' : '#2e2e5a'}`,
            borderRadius: 4, padding: '3px 24px 3px 10px',
            color: active ? '#a78bfa' : '#9090b0',
            fontSize: 11, width: 140,
          }}
        />
        {search && (
          <button
            onMouseDown={clear}
            style={{
              position: 'absolute', right: 5,
              background: 'none', border: 'none', padding: 0,
              color: '#4a4a6a', cursor: 'pointer', fontSize: 12, lineHeight: 1,
            }}
          >×</button>
        )}
      </div>
      {focused && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0,
          background: '#13132a', border: '1px solid #2e2e5a',
          borderRadius: 5, marginTop: 3, zIndex: 20,
          minWidth: 160, maxHeight: 200, overflowY: 'auto',
        }}>
          {matches.map((opt) => (
            <div
              key={opt}
              onMouseDown={() => select(opt)}
              style={{ padding: '6px 10px', fontSize: 11, color: '#c4c4e0', cursor: 'pointer', whiteSpace: 'nowrap' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#1e1e3a'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Build the location string from exchange + planet selections
function buildLocation(atExchange, planet) {
  if (atExchange && planet) return `Exchange Station, ${planet}`;
  if (atExchange)           return 'Exchange Station';
  return planet;
}

// Parse a stored location string back into { atExchange, planet }
function parseLocation(loc) {
  if (!loc) return { atExchange: true, planet: '' };
  if (loc === 'Exchange Station') return { atExchange: true, planet: '' };
  if (loc.startsWith('Exchange Station, ')) return { atExchange: true, planet: loc.slice('Exchange Station, '.length) };
  return { atExchange: false, planet: loc };
}

function LocationPicker({ planets, atExchange, setAtExchange, planet, setPlanet, planetSearch, setPlanetSearch }) {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b6b8a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Location</div>

      {/* Exchange Station checkbox */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
        <input
          type="checkbox" checked={atExchange} onChange={(e) => setAtExchange(e.target.checked)}
          style={{ accentColor: '#7c3aed', width: 14, height: 14 }}
        />
        <span style={{ fontSize: 12, color: atExchange ? '#e0e0ff' : '#6b6b8a' }}>Exchange Station</span>
      </label>

      {/* Optional planet typeahead */}
      <div style={{ position: 'relative' }}>
        <input
          type="text" value={planetSearch} placeholder="+ Add a planet (optional)"
          onChange={(e) => { setPlanetSearch(e.target.value); setPlanet(''); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          style={{
            width: '100%', boxSizing: 'border-box', background: '#13132a',
            border: `1px solid ${planet ? '#4c1d95' : '#2e2e5a'}`, borderRadius: 5,
            padding: '7px 10px', color: '#e0e0ff', fontSize: 12,
          }}
        />
        {focused && planetSearch && !planet && (() => {
          const q = planetSearch.toLowerCase();
          const matches = planets.filter((p) => p !== 'Exchange Station' && p.toLowerCase().includes(q)).slice(0, 12);
          return matches.length > 0 ? (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 5, marginTop: 2, maxHeight: 180, overflowY: 'auto', zIndex: 10 }}>
              {matches.map((p) => (
                <div key={p} onMouseDown={() => { setPlanet(p); setPlanetSearch(p); }}
                  style={{ padding: '7px 10px', fontSize: 12, color: '#c4c4e0', cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#1e1e3a'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
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

function PostModal({ onClose, onPosted, items, planets, listingCount }) {
  const [type,          setType]          = useState('buy');
  const [search,        setSearch]        = useState('');
  const [selectedItem,  setSelectedItem]  = useState(null);
  const [atExchange,    setAtExchange]    = useState(true);
  const [planet,        setPlanet]        = useState('');
  const [planetSearch,  setPlanetSearch]  = useState('');
  const [maxQty,        setMaxQty]        = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [err,           setErr]           = useState('');

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.matName.toLowerCase().includes(q)) : items;
  }, [items, search]);

  async function handleSubmit(e) {
    e.preventDefault();
    const location = buildLocation(atExchange, planet);
    if (!selectedItem) { setErr('Select an item'); return; }
    if (!location)     { setErr('Select Exchange Station or a planet'); return; }
    if (!maxQty || Number(maxQty) < 1) { setErr('Enter a valid quantity'); return; }
    setErr('');
    setSubmitting(true);
    try {
      await api.postContract({
        type,
        matId:       selectedItem.matId,
        matName:     selectedItem.matName,
        planet:      location,
        maxDailyQty: Number(maxQty),
      });
      onPosted();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 10, padding: '28px 20px', width: 'min(380px, 95vw)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0ff' }}>Post a listing</span>
            <div style={{ fontSize: 11, color: listingCount >= 10 ? '#f87171' : '#6b6b8a', marginTop: 2 }}>
              {listingCount} / 10 listings used
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Buy / Sell toggle */}
          <div style={{ display: 'flex', gap: 0, background: '#13132a', borderRadius: 6, padding: 3 }}>
            {['buy', 'sell'].map((t) => (
              <button
                key={t} type="button" onClick={() => setType(t)}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, border: 'none',
                  borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize',
                  background: type === t ? (t === 'buy' ? '#0a1f18' : '#1f0a0a') : 'transparent',
                  color: type === t ? (t === 'buy' ? '#34d399' : '#f87171') : '#4a4a6a',
                  outline: type === t ? `1px solid ${t === 'buy' ? '#065f46' : '#7f1d1d'}` : 'none',
                }}
              >
                Looking to {t}
              </button>
            ))}
          </div>

          {/* Item search */}
          <div>
            <div style={{ fontSize: 11, color: '#6b6b8a', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Item</div>
            <input
              type="text" placeholder="Search items…" value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedItem(null); }}
              style={{ width: '100%', boxSizing: 'border-box', background: '#13132a', border: `1px solid ${selectedItem ? '#4c1d95' : '#2e2e5a'}`, borderRadius: 5, padding: '8px 10px', color: '#e0e0ff', fontSize: 12 }}
            />
            {search && !selectedItem && filteredItems.length > 0 && (
              <div style={{ background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 5, marginTop: 2, maxHeight: 160, overflowY: 'auto' }}>
                {filteredItems.slice(0, 20).map((item) => (
                  <div
                    key={item.matId}
                    onClick={() => { setSelectedItem(item); setSearch(item.matName); }}
                    style={{ padding: '7px 10px', fontSize: 12, color: '#c4c4e0', cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#1e1e3a'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {item.matName}
                  </div>
                ))}
              </div>
            )}
          </div>

          <LocationPicker
            planets={planets}
            atExchange={atExchange} setAtExchange={setAtExchange}
            planet={planet} setPlanet={setPlanet}
            planetSearch={planetSearch} setPlanetSearch={setPlanetSearch}
          />

          {/* Max Daily Qty */}
          <div>
            <div style={{ fontSize: 11, color: '#6b6b8a', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Max Daily Qty</div>
            <input
              type="number" placeholder="e.g. 500" value={maxQty} min={1}
              onChange={(e) => setMaxQty(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 5, padding: '8px 10px', color: '#e0e0ff', fontSize: 12 }}
            />
          </div>

          {err && <p style={{ margin: 0, color: '#f87171', fontSize: 12 }}>{err}</p>}

          <button
            type="submit" disabled={submitting}
            style={{
              background: submitting ? '#2e1e6a' : '#4c1d95', color: '#e0e0ff',
              border: 'none', borderRadius: 5, padding: '10px 0',
              fontSize: 13, fontWeight: 500,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Posting…' : 'Post listing'}
          </button>
        </form>
      </div>
    </div>
  );
}

function EditModal({ contract, onClose, onSaved, items, planets }) {
  const parsed = parseLocation(contract.planet);
  const [type,         setType]         = useState(contract.type);
  const [search,       setSearch]       = useState(contract.mat_name);
  const [selectedItem, setSelectedItem] = useState({ matId: contract.mat_id, matName: contract.mat_name });
  const [atExchange,   setAtExchange]   = useState(parsed.atExchange);
  const [planet,       setPlanet]       = useState(parsed.planet);
  const [planetSearch, setPlanetSearch] = useState(parsed.planet);
  const [maxQty,       setMaxQty]       = useState(String(contract.max_daily_qty));
  const [submitting,   setSubmitting]   = useState(false);
  const [err,          setErr]          = useState('');

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q && !selectedItem ? items.filter((i) => i.matName.toLowerCase().includes(q)) : [];
  }, [items, search, selectedItem]);

  async function handleSubmit(e) {
    e.preventDefault();
    const location = buildLocation(atExchange, planet);
    if (!selectedItem) { setErr('Select an item'); return; }
    if (!location)     { setErr('Select Exchange Station or a planet'); return; }
    if (!maxQty || Number(maxQty) < 1) { setErr('Enter a valid quantity'); return; }
    setErr('');
    setSubmitting(true);
    try {
      await api.updateContract(contract.id, {
        type, matId: selectedItem.matId, matName: selectedItem.matName,
        planet: location, maxDailyQty: Number(maxQty),
      });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 10, padding: '28px 28px', width: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0ff' }}>Edit listing</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Buy/Sell */}
          <div style={{ display: 'flex', gap: 0, background: '#13132a', borderRadius: 6, padding: 3 }}>
            {['buy', 'sell'].map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} style={{
                flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, border: 'none',
                borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize',
                background: type === t ? (t === 'buy' ? '#0a1f18' : '#1f0a0a') : 'transparent',
                color: type === t ? (t === 'buy' ? '#34d399' : '#f87171') : '#4a4a6a',
                outline: type === t ? `1px solid ${t === 'buy' ? '#065f46' : '#7f1d1d'}` : 'none',
              }}>Looking to {t}</button>
            ))}
          </div>

          {/* Item */}
          <div>
            <div style={{ fontSize: 11, color: '#6b6b8a', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Item</div>
            <input type="text" placeholder="Search items…" value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedItem(null); }}
              style={{ width: '100%', boxSizing: 'border-box', background: '#13132a', border: `1px solid ${selectedItem ? '#4c1d95' : '#2e2e5a'}`, borderRadius: 5, padding: '8px 10px', color: '#e0e0ff', fontSize: 12 }}
            />
            {filteredItems.length > 0 && (
              <div style={{ background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 5, marginTop: 2, maxHeight: 160, overflowY: 'auto' }}>
                {filteredItems.slice(0, 20).map((item) => (
                  <div key={item.matId} onClick={() => { setSelectedItem(item); setSearch(item.matName); }}
                    style={{ padding: '7px 10px', fontSize: 12, color: '#c4c4e0', cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#1e1e3a'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >{item.matName}</div>
                ))}
              </div>
            )}
          </div>

          <LocationPicker planets={planets}
            atExchange={atExchange} setAtExchange={setAtExchange}
            planet={planet} setPlanet={setPlanet}
            planetSearch={planetSearch} setPlanetSearch={setPlanetSearch}
          />

          {/* Max qty */}
          <div>
            <div style={{ fontSize: 11, color: '#6b6b8a', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Max Daily Qty</div>
            <input type="number" placeholder="e.g. 500" value={maxQty} min={1}
              onChange={(e) => setMaxQty(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 5, padding: '8px 10px', color: '#e0e0ff', fontSize: 12 }}
            />
          </div>

          {err && <p style={{ margin: 0, color: '#f87171', fontSize: 12 }}>{err}</p>}
          <button type="submit" disabled={submitting} style={{
            background: submitting ? '#2e1e6a' : '#4c1d95', color: '#e0e0ff',
            border: 'none', borderRadius: 5, padding: '10px 0', fontSize: 13, fontWeight: 500,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Manage Listings Modal ─────────────────────────────────────────────────────

function ManageListingsModal({ listings, deleting, actioning, onCancel, onBump, onEdit, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '20px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 12,
          width: '100%', maxWidth: 680, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #1e1e3a' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0ff' }}>
            Manage Listings
            <span style={{ fontSize: 11, color: '#4c1d95', marginLeft: 8 }}>({listings.length} / 10)</span>
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
        </div>

        {/* Listings */}
        <div style={{ overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {listings.length === 0 ? (
            <p style={{ color: '#3a3a55', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No active listings.</p>
          ) : listings.map((c) => {
            const isCancelling = deleting === c.id;
            const busy = isCancelling || !!actioning;
            const interests = c.interests ?? [];
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: '#13132a', border: '1px solid #1e1e3a', borderRadius: 8,
                padding: '8px 12px',
              }}>
                <svg width="18" height="18" style={{ flexShrink: 0 }}>
                  <use href={`${SPRITE_URL}#${toIconId(c.mat_name)}`} width="18" height="18" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.mat_name}</span>
                    <TypeBadge type={c.type} />
                  </div>
                  <div style={{ fontSize: 11, color: '#6b6b8a', marginTop: 1 }}>
                    {c.planet} · {Number(c.max_daily_qty).toLocaleString()}/day
                    {interests.length > 0 && (
                      <span style={{ color: '#a78bfa', marginLeft: 6 }}>· {interests.length} interested</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  <BumpButton contract={c} actioning={actioning} onBump={onBump} compact />
                  <button
                    onClick={() => { onEdit(c); onClose(); }}
                    disabled={busy}
                    style={{ background: 'none', border: '1px solid #1e2e4a', borderRadius: 4, padding: '3px 8px', color: '#60a5fa', fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
                  >Edit</button>
                  <button
                    onClick={() => !busy && onCancel(c.id)}
                    disabled={busy}
                    style={{ background: 'none', border: '1px solid #2e1a1a', borderRadius: 4, padding: '3px 8px', color: '#7f1d1d', fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer', opacity: isCancelling ? 0.5 : 1 }}
                  >{isCancelling ? '…' : 'Remove'}</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Contracts() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus') ? Number(searchParams.get('focus')) : null;
  const didFocus = useRef(false);

  const [contracts,    setContracts]    = useState([]);
  const [items,        setItems]        = useState([]);
  const [planets,      setPlanets]      = useState(['Exchange Station']);
  const [loading,      setLoading]      = useState(true);
  const [err,          setErr]          = useState('');
  const [typeFilter,      setTypeFilter]      = useState('all');
  const [itemSearch,      setItemSearch]      = useState('');
  const [planetFilter,    setPlanetFilter]    = useState('');
  const [pillItem,        setPillItem]        = useState('');
  const [pillPlanet,      setPillPlanet]      = useState('');
  const [modalOpen,    setModalOpen]    = useState(false);
  const [deleting,        setDeleting]        = useState(null);
  const [actioning,       setActioning]       = useState(null); // { id, type: 'fulfill'|'bump' }
  const [editingContract, setEditingContract] = useState(null);
  const [manageOpen,      setManageOpen]      = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, it, gd] = await Promise.all([api.contracts(), api.allItems(), api.gamedata()]);
      setContracts(c);
      setItems(it);
      const systems = gd?.systems ?? [];
      const names = systems
        .flatMap((s) => s.planets ?? [])
        .map((p) => p.name)
        .filter(Boolean)
        .sort();
      // Exchange Station may be a special location not in systems; always include it first
      if (!names.includes('Exchange Station')) names.unshift('Exchange Station');
      else { names.splice(names.indexOf('Exchange Station'), 1); names.unshift('Exchange Station'); }
      if (names.length > 0) setPlanets(names);
      setErr('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Scroll to and briefly highlight a contract when arriving via notification link
  useEffect(() => {
    if (!focusId || loading || didFocus.current) return;
    const el = document.getElementById(`contract-${focusId}`);
    if (!el) return;
    didFocus.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '2px solid #fbbf24';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2500);
  }, [focusId, loading]);

  const filtered = useMemo(() => {
    const q = (itemSearch || pillItem).trim().toLowerCase();
    const pf = planetFilter || pillPlanet;
    return contracts.filter((c) => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (q && c.mat_name.toLowerCase() !== q) return false;
      if (pf && !c.planet.toLowerCase().includes(pf.toLowerCase())) return false;
      return true;
    });
  }, [contracts, typeFilter, itemSearch, pillItem, planetFilter, pillPlanet]);


  const myListings    = useMemo(() => contracts.filter((c) => c.owner_user_id === user?.id), [contracts, user]);
  const allItemNames  = useMemo(() => items.map((i) => i.matName).sort(), [items]);

  async function handleDelete(id) {
    setDeleting(id);
    try {
      await api.deleteContract(id);
      setContracts((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleFulfill(id) {
    setActioning({ id, type: 'fulfill' });
    try {
      await api.fulfillContract(id);
      setContracts((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert(e.message);
    } finally {
      setActioning(null);
    }
  }

  async function handleBump(id) {
    setActioning({ id, type: 'bump' });
    try {
      await api.bumpContract(id);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setActioning(null);
    }
  }

  function handleEdit(contract) {
    setEditingContract(contract);
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 10,
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: '#e0e0ff' }}>Contract Marketplace</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b6b8a' }}>
            Browse listings from players, and contact them in-game to negotiate terms!
          </p>
        </div>
        {user && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {myListings.length > 0 && (
              <button
                onClick={() => setManageOpen(true)}
                style={{
                  background: 'none', border: '1px solid #2e2e5a',
                  borderRadius: 6, padding: '8px 16px', color: '#a78bfa',
                  fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                Manage listings ({myListings.length})
              </button>
            )}
            <button
              onClick={() => setModalOpen(true)}
              style={{
                background: '#1e1440', border: '1px solid #4c1d95',
                borderRadius: 6, padding: '8px 16px', color: '#a78bfa',
                fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              + Post listing
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        {/* Type filter */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[['all', 'All'], ['buy', 'Buying'], ['sell', 'Selling']].map(([val, label]) => (
            <button
              key={val} onClick={() => setTypeFilter(val)}
              style={{
                background: typeFilter === val ? '#1e1440' : 'none',
                border: `1px solid ${typeFilter === val ? '#7c3aed' : '#2e2e5a'}`,
                borderRadius: 4, padding: '3px 10px',
                color: typeFilter === val ? '#a78bfa' : '#6b6b8a',
                fontSize: 11, cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: '#1e1e3a' }} />

        {/* Item autocomplete */}
        <FilterTypeahead
          options={allItemNames}
          value={itemSearch}
          onChange={setItemSearch}
          placeholder="Search item…"
        />

        {/* Planet autocomplete */}
        <FilterTypeahead
          options={planets}
          value={planetFilter}
          onChange={setPlanetFilter}
          placeholder="Filter by planet…"
        />
      </div>

      {err && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 16 }}>{err}</p>}

      {/* Filter suggestion pills */}
      {!loading && (() => {
        const others = contracts.filter((c) => c.owner_user_id !== user?.id);
        const itemCounts = {};
        const planetCounts = {};
        for (const c of others) {
          itemCounts[c.mat_name] = (itemCounts[c.mat_name] ?? 0) + 1;
          for (const p of c.planet.split(',').map((s) => s.trim()).filter(Boolean)) {
            planetCounts[p] = (planetCounts[p] ?? 0) + 1;
          }
        }
        const topItems   = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
        const topPlanets = Object.entries(planetCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
        const pillStyle = (active) => ({
          background: active ? '#1e1440' : 'none',
          border: `1px solid ${active ? '#7c3aed' : '#2e2e5a'}`,
          borderRadius: 20, padding: '3px 10px',
          color: active ? '#a78bfa' : '#6b6b8a',
          fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
        });
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {topItems.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#3a3a55', textTransform: 'uppercase', letterSpacing: 1, marginRight: 2 }}>Items</span>
                {topItems.map((name) => (
                  <button key={name} onClick={() => setPillItem(pillItem === name ? '' : name)} style={pillStyle(pillItem === name)}>{name}</button>
                ))}
              </div>
            )}
            {topPlanets.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#3a3a55', textTransform: 'uppercase', letterSpacing: 1, marginRight: 2 }}>Planets</span>
                {topPlanets.map((name) => (
                  <button key={name} onClick={() => setPillPlanet(pillPlanet === name ? '' : name)} style={pillStyle(pillPlanet === name)}>{name}</button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: 1 }}>Recent listings</span>
        {!loading && <span style={{ fontSize: 10, color: '#3a3a55' }}>({filtered.length})</span>}
      </div>

      {loading ? (
        <p style={{ color: '#6b6b8a', textAlign: 'center', marginTop: 60 }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#3a3a55', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
          No listings found.
        </p>
      ) : (
        <div style={gridStyle}>
          {filtered.map((c) => (
            <ContractCard key={c.id} contract={c} isOwn={c.owner_user_id === user?.id} />
          ))}
        </div>
      )}

      {manageOpen && (
        <ManageListingsModal
          listings={myListings}
          deleting={deleting}
          actioning={actioning}
          onCancel={handleDelete}
          onBump={handleBump}
          onEdit={handleEdit}
          onClose={() => setManageOpen(false)}
        />
      )}

      {modalOpen && (
        <PostModal
          items={items}
          planets={planets}
          listingCount={myListings.length}
          onClose={() => setModalOpen(false)}
          onPosted={() => { setModalOpen(false); load(); }}
        />
      )}

      {editingContract && (
        <EditModal
          contract={editingContract}
          items={items}
          planets={planets}
          onClose={() => setEditingContract(null)}
          onSaved={() => { setEditingContract(null); load(); }}
        />
      )}
    </div>
  );
}
