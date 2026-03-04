import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Tracker from './pages/Tracker';
import ErrorBoundary from './components/ErrorBoundary';
import { api } from './api';

function TrackerCountdown() {
  const [status,  setStatus]  = useState(null);
  const [now,     setNow]     = useState(Date.now());

  useEffect(() => {
    const fetchStatus = async () => {
      try { setStatus(await api.trackerStatus()); } catch { /* server starting */ }
    };
    fetchStatus();
    const si = setInterval(fetchStatus, 3_000);
    return () => clearInterval(si);
  }, []);

  // Tick every second for smooth countdown
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
    <div title={`Tracker polls every ${intervalSec}s · ${status.pollCount} polls completed`}
         style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b6b8a' }}>
      <span style={{ color: '#3a3a55' }}>next poll</span>
      <div style={{ width: 48, height: 4, background: '#1e1e3a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 1s linear' }} />
      </div>
      <span style={{ color, fontVariantNumeric: 'tabular-nums', minWidth: 24 }}>{remaining}s</span>
    </div>
  );
}

function Nav() {
  return (
    <nav>
      <div className="nav-brand">Galactic Tycoons Manager</div>
      <div className="nav-links">
        <NavLink to="/tracker" end>Tracker</NavLink>
      </div>
      <TrackerCountdown />
    </nav>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Nav />
        <main>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Tracker />} />
              <Route path="/tracker" element={<Tracker />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
