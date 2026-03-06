import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import ItemDetail from './pages/ItemDetail';
import ItemGrid from './pages/ItemGrid';
import Login from './pages/Login';
import Admin from './pages/Admin';
import ErrorBoundary from './components/ErrorBoundary';
import { api } from './api';

// ── Poll countdown ────────────────────────────────────────────────────────────

function TrackerCountdown() {
  const [status, setStatus] = useState(null);
  const [now,    setNow]    = useState(Date.now());

  useEffect(() => {
    const fetchStatus = async () => {
      try { setStatus(await api.trackerStatus()); } catch { /* server starting */ }
    };
    fetchStatus();
    const si = setInterval(fetchStatus, 3_000);
    return () => clearInterval(si);
  }, []);

  useEffect(() => {
    const ti = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(ti);
  }, []);

  if (!status?.lastPollAt) return null;

  const intervalSec = status.intervalMs / 1000;
  const elapsed     = (now - new Date(status.lastPollAt).getTime()) / 1000;
  const remaining   = Math.max(0, Math.ceil(intervalSec - elapsed));
  const pct         = (remaining / intervalSec) * 100;
  const color       = remaining > 30 ? '#10b981' : remaining > 10 ? '#fbbf24' : '#f87171';

  return (
    <div title={`Tracker polls every ${intervalSec}s`}
         style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b6b8a' }}>
      <span style={{ color: '#3a3a55' }}>next poll</span>
      <div style={{ width: 48, height: 4, background: '#1e1e3a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 1s linear' }} />
      </div>
      <span style={{ color, fontVariantNumeric: 'tabular-nums', minWidth: 24 }}>{remaining}s</span>
    </div>
  );
}

// ── User settings modal ───────────────────────────────────────────────────────

function SettingsModal({ onClose }) {
  const { user, refreshUser, logout } = useAuth();
  const [untracking, setUntracking] = useState(null);
  const [revoking,   setRevoking]   = useState(false);
  const [err, setErr] = useState('');

  const trackedItems = user?.trackedItems ?? [];

  async function handleUntrack(matId, matName) {
    const ok = window.confirm(
      `Stop tracking ${matName}?\n\nThis will end data collection for everyone on the platform — all users will lose access to live market data for this item.`
    );
    if (!ok) return;
    setUntracking(matId);
    setErr('');
    try {
      await api.untrackItem(matId);
      await refreshUser();
    } catch (e) {
      setErr(e.message);
    } finally {
      setUntracking(null);
    }
  }

  async function handleRevoke() {
    if (!window.confirm('Delete your account?\n\nAll items you are tracking will stop collecting data for everyone on the platform.')) return;
    setRevoking(true);
    try {
      await api.revokeAccount();
      await logout();
      onClose();
    } catch (e) {
      setErr(e.message);
      setRevoking(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
        zIndex: 1000, paddingTop: 48, paddingRight: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 10,
          padding: '16px 20px', minWidth: 280,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ color: '#9090b0', fontSize: 13, fontWeight: 500 }}>
            {user?.companyName}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
        </div>

        {/* Tracked items */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Your tracked items
          </div>
          {trackedItems.length === 0 ? (
            <div style={{ color: '#3a3a55', fontSize: 12 }}>None — click any untracked item to start tracking.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {trackedItems.map((ti) => (
                <div key={ti.matId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: '#e0e0f0', fontSize: 13 }}>{ti.matName}</span>
                  <button
                    onClick={() => handleUntrack(ti.matId, ti.matName)}
                    disabled={untracking === ti.matId}
                    style={{
                      background: 'none', border: '1px solid #2e2e5a', borderRadius: 4,
                      padding: '2px 8px', color: '#6b6b8a', fontSize: 11,
                      cursor: untracking === ti.matId ? 'not-allowed' : 'pointer',
                      opacity: untracking === ti.matId ? 0.5 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {untracking === ti.matId ? '…' : 'Untrack'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {err && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{err}</p>}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #1e1e3a', paddingTop: 16 }}>
          <button
            onClick={logout}
            style={{
              background: 'none', border: '1px solid #2e2e5a', borderRadius: 6,
              padding: '7px 12px', color: '#9090b0', fontSize: 12, cursor: 'pointer', textAlign: 'left',
            }}
          >
            Sign out
          </button>
          <button
            onClick={handleRevoke}
            disabled={revoking}
            style={{
              background: 'none', border: '1px solid #3a1a1a', borderRadius: 6,
              padding: '7px 12px', color: '#f87171', fontSize: 12,
              cursor: revoking ? 'not-allowed' : 'pointer', opacity: revoking ? 0.5 : 1, textAlign: 'left',
            }}
          >
            {revoking ? 'Revoking…' : 'Revoke account'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function Nav() {
  const { user } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <nav>
        <Link to="/" style={{ textDecoration: 'none' }}><div className="nav-brand">GT-Tracker</div></Link>
        <div className="nav-links" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <TrackerCountdown />
          {user && (
            <button
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              style={{
                background: 'none', border: '1px solid #2e2e5a', borderRadius: 6,
                padding: '4px 8px', color: '#6b6b8a', fontSize: 16, cursor: 'pointer',
                lineHeight: 1, display: 'flex', alignItems: 'center',
              }}
            >
              ⚙
            </button>
          )}
        </div>
      </nav>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

// ── Route guard ───────────────────────────────────────────────────────────────

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null;
  if (!user)  return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Nav />
          <main>
            <ErrorBoundary>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/:slug" element={<RequireAuth><ItemDetail /></RequireAuth>} />
                <Route path="/" element={<RequireAuth><ItemGrid /></RequireAuth>} />
              </Routes>
            </ErrorBoundary>
          </main>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
