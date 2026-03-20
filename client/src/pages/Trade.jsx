import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { toIconId } from '../utils/materialIcon';

const SPRITE_URL = '/api/gamedata/sprite';

// ── Helpers ───────────────────────────────────────────────────────────────────

function MatIcon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <use href={`${SPRITE_URL}#${toIconId(name)}`} width={size} height={size} />
    </svg>
  );
}

function fmtPrice(type, value) {
  if (type === 'fixed') return `${Number(value).toLocaleString()} cr`;
  return `Market ${value} cr`; // value is negative e.g. -1
}

function parsePrice(raw) {
  const val = raw.trim();
  if (/^\d+$/.test(val)) {
    return { price_type: 'fixed', price_value: parseInt(val, 10) };
  }
  const offsetMatch = val.match(/^market\s*-\s*(\d+)$/i);
  if (offsetMatch) {
    return { price_type: 'market_offset', price_value: -parseInt(offsetMatch[1], 10) };
  }
  return null;
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

// ── Item search dropdown ───────────────────────────────────────────────────────

function ItemSearch({ items, onSelect }) {
  const [query, setQuery]   = useState('');
  const [open, setOpen]     = useState(false);
  const wrapRef             = useRef(null);

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

  function handleSelect(item) {
    onSelect(item);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
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
              onMouseDown={() => handleSelect(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#1a1a35'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <MatIcon name={item.matName} size={18} />
              <span style={{ fontSize: 13, color: '#b0b0cc' }}>{item.matName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Trade() {
  const { user } = useAuth();

  const [listings,    setListings]    = useState([]);
  const [allItems,    setAllItems]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState('');
  const [formOpen,    setFormOpen]    = useState(false);

  // Form state
  const [selItem,     setSelItem]     = useState(null);  // { matId, matName }
  const [priceRaw,    setPriceRaw]    = useState('');
  const [priceErr,    setPriceErr]    = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [submitErr,   setSubmitErr]   = useState('');

  // Deleting
  const [deletingId, setDeletingId]  = useState(null);

  useEffect(() => {
    Promise.all([api.tradeListings(), api.allItems()])
      .then(([ls, items]) => { setListings(ls); setAllItems(items); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setPriceErr('');
    setSubmitErr('');

    if (!selItem) return setSubmitErr('Please select an item.');
    const parsed = parsePrice(priceRaw);
    if (!parsed) {
      setPriceErr('Enter a price like 1650 or Market -1');
      return;
    }

    setSubmitting(true);
    try {
      const row = await api.tradeAdd({
        mat_id:      selItem.matId,
        mat_name:    selItem.matName,
        price_type:  parsed.price_type,
        price_value: parsed.price_value,
      });
      setListings((prev) => [row, ...prev]);
      setSelItem(null);
      setPriceRaw('');
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

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>;

  const guildTag = listings[0]?.guild_tag ?? user?.companyTag ?? '';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20, color: '#d8d8f0', fontWeight: 600 }}>
              Guild Trade Board
            </h2>
            {guildTag && (
              <span style={{
                padding: '2px 8px', background: '#1e1e3a', border: '1px solid #3a3a5a',
                borderRadius: 4, fontSize: 11, color: '#8080aa', fontWeight: 600, letterSpacing: 1,
              }}>
                {guildTag}
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a5a7a' }}>
            Internal guild pricing — visible to guild members only
          </p>
        </div>
        <button
          onClick={() => { setFormOpen((o) => !o); setSubmitErr(''); setPriceErr(''); }}
          style={{
            marginLeft: 'auto', padding: '7px 14px',
            background: formOpen ? '#1e1e3a' : '#3730a3',
            border: '1px solid ' + (formOpen ? '#3a3a5a' : '#4f46e5'),
            borderRadius: 6, color: '#d8d8f0', fontSize: 13, cursor: 'pointer',
          }}
        >
          {formOpen ? '✕ Cancel' : '+ Add Listing'}
        </button>
      </div>

      {/* Add listing form */}
      {formOpen && (
        <form onSubmit={handleSubmit} style={{
          marginBottom: 20, padding: '14px 16px',
          background: '#0d0d1f', border: '1px solid #2a2a4a', borderRadius: 8,
        }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Item search */}
            <div style={{ flex: '2 1 180px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 4 }}>Item</label>
              {selItem ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  background: '#0d0d1f', border: '1px solid #3730a3', borderRadius: 6,
                  cursor: 'pointer',
                }} onClick={() => setSelItem(null)}>
                  <MatIcon name={selItem.matName} size={18} />
                  <span style={{ fontSize: 13, color: '#d8d8f0', flex: 1 }}>{selItem.matName}</span>
                  <span style={{ fontSize: 11, color: '#5a5a7a' }}>✕</span>
                </div>
              ) : (
                <ItemSearch
                  items={allItems}
                  onSelect={(item) => setSelItem({ matId: item.matId, matName: item.matName })}
                />
              )}
            </div>

            {/* Price input */}
            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#6b6b8a', marginBottom: 4 }}>Price</label>
              <input
                value={priceRaw}
                onChange={(e) => { setPriceRaw(e.target.value); setPriceErr(''); }}
                placeholder="e.g. 1650 or Market -1"
                style={{
                  width: '100%', padding: '7px 10px', background: '#0d0d1f',
                  border: '1px solid ' + (priceErr ? '#ef4444' : '#2a2a4a'),
                  borderRadius: 6, color: '#d8d8f0', fontSize: 13, outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {priceErr && <span style={{ fontSize: 11, color: '#ef4444' }}>{priceErr}</span>}
              {!priceErr && <span style={{ fontSize: 11, color: '#4a4a6a' }}>fixed number or Market -N</span>}
            </div>

            {/* Submit */}
            <div style={{ flex: '0 0 auto', paddingTop: 19 }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '7px 18px', background: '#3730a3', border: '1px solid #4f46e5',
                  borderRadius: 6, color: '#d8d8f0', fontSize: 13, cursor: submitting ? 'default' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? 'Listing…' : 'List Item'}
              </button>
            </div>
          </div>
          {submitErr && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{submitErr}</div>
          )}
        </form>
      )}

      {/* Error */}
      {err && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 6, color: '#fca5a5', fontSize: 13 }}>
          {err}
        </div>
      )}

      {/* Listings table */}
      {listings.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#4a4a6a', fontSize: 14 }}>
          No guild listings yet. Be the first to add one.
        </div>
      ) : (
        <div className="scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e3a' }}>
                {['Company', 'Item', 'Price', 'Posted', ''].map((h) => (
                  <th key={h} style={{
                    padding: '6px 10px', textAlign: 'left', fontWeight: 500,
                    color: '#5a5a7a', fontSize: 11, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => {
                const isOwn = l.user_id === user?.id;
                return (
                  <tr
                    key={l.id}
                    style={{ borderBottom: '1px solid #12122a' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#0d0d1f'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '8px 10px', color: isOwn ? '#a78bfa' : '#8080aa', whiteSpace: 'nowrap' }}>
                      {l.company_name}
                      {isOwn && <span style={{ marginLeft: 5, fontSize: 10, color: '#5a5a7a' }}>(you)</span>}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <MatIcon name={l.mat_name} size={18} />
                        <span style={{ color: '#d8d8f0' }}>{l.mat_name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#e2e8f0', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {fmtPrice(l.price_type, l.price_value)}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#4a4a6a', whiteSpace: 'nowrap' }}>
                      {relTime(l.created_at)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {isOwn && (
                        <button
                          onClick={() => handleDelete(l.id)}
                          disabled={deletingId === l.id}
                          title="Remove listing"
                          style={{
                            background: 'none', border: 'none', color: '#4a4a6a',
                            cursor: 'pointer', fontSize: 14, padding: '0 4px',
                            opacity: deletingId === l.id ? 0.4 : 1,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#4a4a6a'; }}
                        >✕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
