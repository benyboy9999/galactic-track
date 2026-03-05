import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Tracker from './pages/Tracker';
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

// ── Nav ───────────────────────────────────────────────────────────────────────

function Nav() {
  const { user, logout } = useAuth();

  return (
    <nav>
      <div className="nav-brand">GT-Tracker</div>
      <div className="nav-links">
        {user && <NavLink to="/tracker" end>Tracker</NavLink>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <TrackerCountdown />
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ color: '#6b6b8a' }}>{user.companyName}</span>
            <button
              onClick={logout}
              style={{ background: 'none', border: '1px solid #2e2e5a', borderRadius: 4, padding: '3px 10px', color: '#6b6b8a', fontSize: 11, cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

// ── Route guard ───────────────────────────────────────────────────────────────

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null; // wait for session check
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
                <Route path="/tracker" element={<RequireAuth><Tracker /></RequireAuth>} />
                <Route path="/" element={<RequireAuth><Tracker /></RequireAuth>} />
              </Routes>
            </ErrorBoundary>
          </main>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
