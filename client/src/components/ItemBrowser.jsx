import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

// ── Credit pip indicator ──────────────────────────────────────────────────────

function CreditPips({ used, total }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: i < used ? '#a78bfa' : '#2e2e5a',
          }}
        />
      ))}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ItemBrowser({ onClose, onTrackedChange }) {
  const { user, refreshUser }   = useAuth();
  const [items,   setItems]     = useState([]);
  const [search,  setSearch]    = useState('');
  const [loading, setLoading]   = useState(true);
  const [working, setWorking]   = useState(null); // matId being acted on
  const [err,     setErr]       = useState('');

  const creditsUsed  = user?.creditsUsed  ?? 0;
  const creditsTotal = user?.creditsTotal ?? 3;

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

  async function track(matId) {
    setWorking(matId);
    setErr('');
    try {
      await api.trackItem(matId);
      // Refresh items list and user credits
      const [updated] = await Promise.all([api.allItems(), refreshUser()]);
      setItems(updated);
      onTrackedChange?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setWorking(null);
    }
  }

  async function untrack(matId) {
    setWorking(matId);
    setErr('');
    try {
      await api.untrackItem(matId);
      const [updated] = await Promise.all([api.allItems(), refreshUser()]);
      setItems(updated);
      onTrackedChange?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setWorking(null);
    }
  }

  const full = creditsUsed >= creditsTotal;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 10, width: 'min(560px, 95vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #1e1e3a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, color: '#e0e0ff' }}>Item Browser</h2>
              <CreditPips used={creditsUsed} total={creditsTotal} />
              <span style={{ fontSize: 11, color: '#6b6b8a' }}>{creditsUsed}/{creditsTotal} credits used</span>
            </div>
            {full && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#fbbf24' }}>
                Credit limit reached — untrack an item to free a slot.
              </p>
            )}
          </div>
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
          {filtered.map((item) => {
            const isTracked = item.tracked;
            const isMine    = isTracked && item.trackedBy === user?.companyName;
            const busy      = working === item.matId;

            return (
              <div
                key={item.matId}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 10px', borderRadius: 6, marginBottom: 2,
                  background: isTracked ? '#0f0f2a' : 'transparent',
                  opacity: isTracked && !isMine ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: isTracked ? '#e0e0ff' : '#9090b0' }}>
                    {item.matName}
                  </span>
                  {item.category && (
                    <span style={{ fontSize: 11, color: '#4a4a6a' }}>{item.category}</span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isTracked && !isMine && (
                    <span style={{ fontSize: 11, color: '#a78bfa', background: '#1e1440', padding: '2px 8px', borderRadius: 10 }}>
                      Tracked by {item.trackedBy ?? 'another user'}
                    </span>
                  )}
                  {isMine && (
                    <button
                      onClick={() => untrack(item.matId)}
                      disabled={busy}
                      style={{
                        background: '#1c0a0a', color: '#fca5a5', border: '1px solid #7f1d1d',
                        borderRadius: 4, padding: '4px 12px', fontSize: 11, cursor: busy ? 'not-allowed' : 'pointer',
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      {busy ? '…' : 'Untrack'}
                    </button>
                  )}
                  {!isTracked && (
                    <button
                      onClick={() => track(item.matId)}
                      disabled={busy || full}
                      title={full ? 'No credits remaining' : `Use 1 credit to track ${item.matName}`}
                      style={{
                        background: full ? '#1a1a2e' : '#1e0a3a',
                        color: full ? '#3a3a55' : '#a78bfa',
                        border: `1px solid ${full ? '#2e2e5a' : '#4c1d95'}`,
                        borderRadius: 4, padding: '4px 12px', fontSize: 11,
                        cursor: busy || full ? 'not-allowed' : 'pointer',
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      {busy ? '…' : 'Track (1 credit)'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
