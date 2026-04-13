import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';

export default function ItemBrowser({ onClose }) {
  const [items,   setItems]   = useState([]);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    api.allItems()
      .then(setItems)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.matName.toLowerCase().includes(q));
  }, [items, search]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 10, width: 'min(560px, 95vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #1e1e3a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: '#e0e0ff' }}>Item Browser</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b6b8a', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #1e1e3a', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Search materials…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{ width: '100%', boxSizing: 'border-box', background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 5, padding: '8px 12px', color: '#e0e0ff', fontSize: 13 }}
          />
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px' }}>
          {loading && <p style={{ color: '#6b6b8a', padding: 16, textAlign: 'center' }}>Loading…</p>}
          {err && <p style={{ color: '#f87171', padding: '8px 8px', fontSize: 13 }}>{err}</p>}
          {!loading && filtered.length === 0 && (
            <p style={{ color: '#4a4a6a', padding: 16, textAlign: 'center' }}>No items match.</p>
          )}
          {filtered.map((item) => (
            <div
              key={item.matId}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 10px', borderRadius: 6, marginBottom: 2,
                background: '#0f0f2a',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, color: '#e0e0ff' }}>{item.matName}</span>
                {item.category && (
                  <span style={{ fontSize: 11, color: '#4a4a6a' }}>{item.category}</span>
                )}
              </div>
              <span style={{ fontSize: 10, color: item.dataReady ? '#34d399' : '#a78bfa', background: item.dataReady ? '#0a1f18' : '#1e1440', border: `1px solid ${item.dataReady ? '#065f46' : '#4c1d95'}`, borderRadius: 10, padding: '2px 8px' }}>
                {item.dataReady ? 'Active' : 'Collecting'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
