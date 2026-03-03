import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import Market from './pages/Market';
import MaterialDetail from './pages/MaterialDetail';
import Profits from './pages/Profits';
import Tracker from './pages/Tracker';
import ErrorBoundary from './components/ErrorBoundary';
import { api } from './api';

function RateLimitindicator() {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);

  async function poll() {
    try {
      const s = await api.ratelimit();
      setStatus(s);
    } catch { /* server may be starting */ }
  }

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, 10_000); // poll every 10s
    return () => clearInterval(timerRef.current);
  }, []);

  if (!status) return null;

  const pct = (status.available / status.max) * 100;
  const color = pct > 50 ? '#10b981' : pct > 20 ? '#fbbf24' : '#f87171';

  return (
    <div title={`Rate limit: ${status.used}/${status.max} units used in current 5-min window${status.resetsIn ? ` · resets in ${status.resetsIn}s` : ''}`}
         style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b6b8a' }}>
      <div style={{ width: 48, height: 4, background: '#1e1e3a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
      <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {status.available}/{status.max}
      </span>
      {status.resetsIn > 0 && (
        <span style={{ color: '#3a3a55' }}>resets {status.resetsIn}s</span>
      )}
    </div>
  );
}

function Nav() {
  return (
    <nav>
      <div className="nav-brand">Galactic Tycoons Manager</div>
      <div className="nav-links">
        <NavLink to="/tracker" end>Tracker</NavLink>
        <NavLink to="/market">Market</NavLink>
        <NavLink to="/profits">Profit Calc</NavLink>
      </div>
      <RateLimitIndicator />
    </nav>
  );
}

// Fix casing
function RateLimitIndicator() { return <RateLimitindicator />; }

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
              <Route path="/market" element={<Market />} />
              <Route path="/market/:matId" element={<MaterialDetail />} />
              <Route path="/profits" element={<Profits />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
