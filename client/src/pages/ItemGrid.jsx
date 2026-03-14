import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { toSlug } from '../utils/slug';
import { toIconId } from '../utils/materialIcon';
import { useMediaQuery } from '../hooks/useMediaQuery';

const spriteUrl = '/api/gamedata/sprite';

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ItemGrid() {
  const navigate  = useNavigate();
  const isMobile  = useMediaQuery(639);

  const [items,        setItems]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [err,          setErr]          = useState('');
  const [search,       setSearch]       = useState('');
  const [tierFilter,   setTierFilter]   = useState(null);
  const [catFilter,    setCatFilter]    = useState('');
  const [sidebar,      setSidebar]      = useState(null);
  const [favourites, setFavourites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('gt-favourites') ?? '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => {
    api.allItems()
      .then(setItems)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    api.trackerSidebar().then(setSidebar).catch(() => {});
  }, []);

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

  const pinnedItems    = filtered.filter((i) => i.tracked && favourites.has(i.matId));
  const trackedItems   = filtered.filter((i) => i.tracked && !favourites.has(i.matId));
  const untrackedItems = filtered.filter((i) => !i.tracked);

  function SectionLabel({ icon, label, count }) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
        color: '#4a4a6a',
      }}>
        {icon && <span style={{ fontSize: 11 }}>{icon}</span>}
        <span>{label}</span>
        <span style={{ color: '#2e2e55', marginLeft: 2 }}>{count}</span>
      </div>
    );
  }

  function ItemCard({ item }) {
    const isFav = favourites.has(item.matId);
    const borderColor = item.tracked ? '#1e1e3a' : '#131328';
    const bg          = item.tracked ? '#0d0d22' : '#09091a';
    return (
      <div
        onClick={() => navigate(`/${toSlug(item.matName)}`)}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = item.tracked ? '#3a3a70' : '#1e1e3a';
          e.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = borderColor;
          e.currentTarget.style.opacity = item.tracked ? '1' : '0.4';
        }}
        style={{
          background: bg, border: `1px solid ${borderColor}`, borderRadius: 7,
          padding: '9px 10px', cursor: 'pointer', transition: 'border-color 0.12s',
          display: 'flex', flexDirection: 'column', gap: 5, position: 'relative',
          opacity: item.tracked ? 1 : 0.4,
        }}
      >
        {item.tracked && (
          <button
            onClick={(e) => toggleFavourite(e, item.matId)}
            title={isFav ? 'Unpin' : 'Pin'}
            style={{
              position: 'absolute', top: 6, right: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, padding: 2, lineHeight: 1,
              color: isFav ? '#fbbf24' : '#1e1e3a',
            }}
          >★</button>
        )}
        <svg width="28" height="28" style={{ flexShrink: 0, filter: item.tracked ? 'none' : 'grayscale(1)' }}>
          <use href={`${spriteUrl}#${toIconId(item.matName)}`} width="28" height="28" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 500, color: item.tracked ? '#d8d8f0' : '#4a4a6a', lineHeight: 1.3 }}>
          {item.matName}
        </span>
        {item.tracked && (
          item.dataReady
            ? <span style={{ fontSize: 10, color: '#34d399', background: '#0a1f18', border: '1px solid #065f46', borderRadius: 4, padding: '1px 5px', alignSelf: 'flex-start' }}>Active</span>
            : <span style={{ fontSize: 10, color: '#a78bfa', background: '#1e1440', border: '1px solid #4c1d95', borderRadius: 4, padding: '1px 5px', alignSelf: 'flex-start' }}>New</span>
        )}
      </div>
    );
  }

  function SidebarCard({ title, subtitle, children }) {
    return (
      <div style={{ background: '#0d0d22', border: '1px solid #1a1a36', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '9px 12px 7px', borderBottom: '1px solid #131328' }}>
          <div style={{ fontSize: 11, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10, color: '#2e2e50', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '16px 12px' : '24px 20px' }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e0e0f0' }}>Item Tracker</h1>
          <div style={{ fontSize: 12, color: '#6b6b8a', marginTop: 2 }}>Market activity overview</div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
            style={{ marginBottom: 0, width: isMobile ? '100%' : 180 }}
          />
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
                {t === null ? 'All' : `T${t}`}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 16, background: '#1e1e3a' }} />
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="select-input"
            style={{ fontSize: 11, padding: '3px 8px' }}
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {err && <p style={{ color: '#f87171', marginBottom: 12, fontSize: 13 }}>{err}</p>}

      {loading ? (
        <p style={{ color: '#6b6b8a', textAlign: 'center', marginTop: 60 }}>Loading…</p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 260px',
          gap: 20,
          alignItems: 'start',
        }}>

          {/* ── Main item sections ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {pinnedItems.length > 0 && (
              <div>
                <SectionLabel icon="★" label="Pinned" count={pinnedItems.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
                  {pinnedItems.map((item) => <ItemCard key={item.matId} item={item} />)}
                </div>
              </div>
            )}

            {trackedItems.length > 0 && (
              <div>
                <SectionLabel label="Tracked" count={trackedItems.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
                  {trackedItems.map((item) => <ItemCard key={item.matId} item={item} />)}
                </div>
              </div>
            )}

            {untrackedItems.length > 0 && (
              <div>
                <SectionLabel label="Untracked" count={untrackedItems.length} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
                  {untrackedItems.map((item) => <ItemCard key={item.matId} item={item} />)}
                </div>
              </div>
            )}

            {pinnedItems.length === 0 && trackedItems.length === 0 && untrackedItems.length === 0 && (
              <div style={{ padding: '32px 16px', color: '#4a4a6a', fontSize: 13, textAlign: 'center' }}>
                No items match your search.
              </div>
            )}
          </div>

          {/* ── Sidebar ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <SidebarCard title="Today's Top Movers" subtitle="Current price vs yesterday's average">
              {!sidebar ? (
                <div style={{ padding: '14px 12px', color: '#3a3a55', fontSize: 12 }}>Loading…</div>
              ) : sidebar.movers.length === 0 ? (
                <div style={{ padding: '14px 12px', color: '#3a3a55', fontSize: 12 }}>No price changes recorded yet today.</div>
              ) : sidebar.movers.map((m) => {
                const pct = Number(m.pct_change);
                return (
                  <div
                    key={m.mat_id}
                    onClick={() => navigate(`/${toSlug(m.mat_name)}`)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#0f0f28'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', transition: 'background 0.1s' }}
                  >
                    <svg width="18" height="18" style={{ flexShrink: 0 }}>
                      <use href={`${spriteUrl}#${toIconId(m.mat_name)}`} width="18" height="18" />
                    </svg>
                    <span style={{ flex: 1, fontSize: 12, color: '#b0b0cc', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.mat_name}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: pct > 0 ? '#34d399' : '#f87171', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {pct > 0 ? '+' : ''}{pct}%
                    </span>
                  </div>
                );
              })}
            </SidebarCard>

            <SidebarCard title="Recently Untracked" subtitle="Items no longer being monitored">
              {!sidebar ? (
                <div style={{ padding: '14px 12px', color: '#3a3a55', fontSize: 12 }}>Loading…</div>
              ) : sidebar.recentlyUntracked.length === 0 ? (
                <div style={{ padding: '14px 12px', color: '#3a3a55', fontSize: 12 }}>Nothing recently untracked.</div>
              ) : sidebar.recentlyUntracked.map((u) => (
                <div
                  key={u.mat_id}
                  onClick={() => navigate(`/${toSlug(u.mat_name)}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#0f0f28'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', transition: 'background 0.1s' }}
                >
                  <svg width="18" height="18" style={{ flexShrink: 0, filter: 'grayscale(1)', opacity: 0.4 }}>
                    <use href={`${spriteUrl}#${toIconId(u.mat_name)}`} width="18" height="18" />
                  </svg>
                  <span style={{ flex: 1, fontSize: 12, color: '#5a5a7a', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.mat_name}
                  </span>
                  <span style={{ fontSize: 10, color: '#3a3a52', flexShrink: 0 }}>{relTime(u.created_at)}</span>
                </div>
              ))}
            </SidebarCard>

          </div>
        </div>
      )}
    </div>
  );
}
