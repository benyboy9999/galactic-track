import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationsProvider, useNotifications } from './context/NotificationsContext';
import { playNotificationChime } from './utils/notifSound';
import { useMediaQuery } from './hooks/useMediaQuery';

const IS_DEV = import.meta.env.DEV;
import ItemDetail from './pages/ItemDetail';
import ItemGrid from './pages/ItemGrid';
import Login from './pages/Login';
import Admin from './pages/Admin';
import Contracts from './pages/Contracts';
import Company from './pages/Company';
import DevCompanySearch from './components/DevCompanySearch';
import ErrorBoundary from './components/ErrorBoundary';
import KeyInfoModal from './components/KeyInfoModal';
import { api } from './api';
import { toSlug } from './utils/slug';

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
  const [untracking,   setUntracking]   = useState(null);
  const [revoking,     setRevoking]     = useState(false);
  const [err,          setErr]          = useState('');
  const [confirm,      setConfirm]      = useState(null); // { title, body, action, danger }
  const [soundOn,      setSoundOn]      = useState(() => localStorage.getItem('notifSoundEnabled') !== 'false');
  const [volume,       setVolume]       = useState(() => parseFloat(localStorage.getItem('notifVolume') ?? '0.4'));
  const [devSwitching,  setDevSwitching]  = useState(false);
  const [showKeyInfo,  setShowKeyInfo]  = useState(false);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem('notifSoundEnabled', String(next));
  }

  function handleVolume(e) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    localStorage.setItem('notifVolume', String(v));
  }

  const trackedItems = user?.trackedItems ?? [];

  function askConfirm(title, body, action, danger = false) {
    setConfirm({ title, body, action, danger });
  }

  async function handleUntrack(matId, matName) {
    askConfirm(
      `Stop tracking ${matName}?`,
      'This will end data collection for everyone on the platform — all users will lose access to live market data for this item.',
      async () => {
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
      },
      true
    );
  }

  async function handleDevSwitch(companyName, companyId) {
    setDevSwitching(true);
    setErr('');
    try {
      const data = await api.devLogin(companyName, companyId);
      localStorage.setItem('sessionToken', data.sessionToken);
      await refreshUser();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setDevSwitching(false);
    }
  }

  async function handleRevoke() {
    askConfirm(
      'Delete your account?',
      'All items you are tracking will stop collecting data for everyone on the platform.',
      async () => {
        setRevoking(true);
        try {
          await api.revokeAccount();
          await logout();
          onClose();
        } catch (e) {
          setErr(e.message);
          setRevoking(false);
        }
      },
      true
    );
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
          padding: '16px 20px', width: 'min(320px, calc(100vw - 32px))',
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

        {/* Notification sound */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Notification sound
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#c0c0d8' }}>Play sound on new notification</span>
            <button
              onClick={toggleSound}
              style={{
                background: soundOn ? '#1e3a2a' : '#1e1e3a',
                border: `1px solid ${soundOn ? '#065f46' : '#2e2e5a'}`,
                borderRadius: 12, padding: '3px 10px',
                color: soundOn ? '#34d399' : '#6b6b8a',
                fontSize: 11, cursor: 'pointer',
              }}
            >{soundOn ? 'On' : 'Off'}</button>
          </div>
          {soundOn && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#6b6b8a', minWidth: 44 }}>Volume</span>
              <input
                type="range" min="0.05" max="1" step="0.05"
                value={volume} onChange={handleVolume}
                style={{ flex: 1, accentColor: '#a78bfa' }}
              />
              <span style={{ fontSize: 11, color: '#6b6b8a', minWidth: 28, textAlign: 'right' }}>
                {Math.round(volume * 100)}%
              </span>
            </div>
          )}
          {IS_DEV && (
            <button
              onClick={playNotificationChime}
              style={{
                marginTop: 8, width: '100%', background: 'none',
                border: '1px dashed #2e2e5a', borderRadius: 5, padding: '5px 0',
                color: '#3a3a55', fontSize: 11, cursor: 'pointer',
              }}
            >
              Test sound
            </button>
          )}
        </div>

        {/* Dev company switcher */}
        {IS_DEV && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: '#6b6b8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Dev — switch company
            </div>
            <DevCompanySearch
              onSelect={(companyName, companyId) => handleDevSwitch(companyName, companyId)}
              disabled={devSwitching}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #1e1e3a', paddingTop: 16 }}>
          <button
            onClick={() => setShowKeyInfo(true)}
            style={{
              background: 'none', border: '1px solid #2e2e5a', borderRadius: 6,
              padding: '7px 12px', color: '#6b6b8a', fontSize: 12, cursor: 'pointer', textAlign: 'left',
            }}
          >
            How is my key used &amp; stored?
          </button>
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

      {showKeyInfo && <KeyInfoModal onClose={() => setShowKeyInfo(false)} />}

      {/* In-app confirm dialog */}
      {confirm && (
        <div
          onClick={() => setConfirm(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#0d0d22', border: `1px solid ${confirm.danger ? '#3a1a1a' : '#2e2e5a'}`, borderRadius: 10, padding: '28px 28px', width: 340, textAlign: 'center' }}
          >
            <p style={{ margin: '0 0 10px', color: '#e0e0ff', fontSize: 14, fontWeight: 600 }}>{confirm.title}</p>
            <p style={{ margin: '0 0 24px', color: '#6b6b8a', fontSize: 13, lineHeight: 1.6 }}>{confirm.body}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                onClick={() => setConfirm(null)}
                style={{ background: 'none', border: '1px solid #2e2e5a', borderRadius: 6, padding: '7px 20px', color: '#9090b0', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => { setConfirm(null); await confirm.action(); }}
                style={{
                  background: confirm.danger ? '#2a0a0a' : '#1e1440',
                  border: `1px solid ${confirm.danger ? '#7f1d1d' : '#4c1d95'}`,
                  borderRadius: 6, padding: '7px 20px',
                  color: confirm.danger ? '#f87171' : '#a78bfa',
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notification bell ─────────────────────────────────────────────────────────

function fmtNotifAgo(iso) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 120)   return `${Math.floor(sec)}s ago`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function NotificationBell() {
  const { unread, notifications, markRead, dismiss } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function toggle() {
    if (!open) markRead();
    setOpen((v) => !v);
  }

  function handleNotifClick(n) {
    setOpen(false);
    if (n.type === 'price_alert') {
      navigate(`/${toSlug(n.mat_name)}`);
    } else if (n.contract_id) {
      navigate(`/contracts?focus=${n.contract_id}`);
    } else {
      navigate('/contracts');
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        title="Notifications"
        style={{
          background: 'none', border: '1px solid #2e2e5a', borderRadius: 6,
          padding: '4px 8px', color: unread > 0 ? '#e0e0ff' : '#6b6b8a',
          fontSize: 15, cursor: 'pointer', lineHeight: 1,
          display: 'flex', alignItems: 'center', position: 'relative',
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 700,
            borderRadius: 10, minWidth: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 10,
          minWidth: 300, maxWidth: 360, maxHeight: 420, overflowY: 'auto',
          zIndex: 1000, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid #1e1e3a' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#9090b0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Notifications
            </span>
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: '20px 16px', fontSize: 13, color: '#3a3a55', textAlign: 'center' }}>
              No notifications
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} style={{
                padding: '10px 16px', borderBottom: '1px solid #13132a',
                background: n.read ? 'transparent' : '#0d0d2e',
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <div
                  onClick={() => handleNotifClick(n)}
                  style={{ flex: 1, cursor: (n.type === 'price_alert' || n.contract_id) ? 'pointer' : 'default' }}
                >
                  <div style={{ fontSize: 13, color: '#c8c8e8', lineHeight: 1.4 }}>
                    {n.type === 'price_alert' ? (
                      <>
                        <span style={{ color: '#fbbf24', fontWeight: 600 }}>{n.mat_name}</span>
                        {' hit your price alert of '}
                        <span style={{ color: '#34d399', fontWeight: 600 }}>{n.from_company}</span>
                      </>
                    ) : n.type === 'untracked' ? (
                      <>
                        <span style={{ color: '#f87171', fontWeight: 600 }}>{n.mat_name}</span>
                        {' was untracked'}
                        {n.from_company ? <> {' by '}<span style={{ color: '#a78bfa', fontWeight: 600 }}>{n.from_company}</span></> : ''}
                      </>
                    ) : (
                      <>
                        <span style={{ color: '#a78bfa', fontWeight: 600 }}>{n.from_company}</span>
                        {' is interested in your '}
                        <span style={{ color: '#e0e0ff', fontWeight: 600 }}>{n.mat_name}</span>
                        {' listing'}
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#3a3a55', marginTop: 3 }}>{fmtNotifAgo(n.created_at)}</div>
                </div>
                <button
                  onClick={() => dismiss(n.id)}
                  title="Dismiss"
                  style={{
                    background: 'none', border: 'none', color: '#3a3a55',
                    cursor: 'pointer', fontSize: 12, padding: '2px 4px', lineHeight: 1,
                    flexShrink: 0,
                  }}
                >✕</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function Nav() {
  const { user } = useAuth();
  const location  = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMediaQuery(639);

  // Close mobile menu on navigation
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const navLink = (to, label, mobile = false) => {
    const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
    if (mobile) {
      return (
        <Link key={to} to={to} className={active ? 'active' : ''}>{label}</Link>
      );
    }
    return (
      <Link to={to} style={{
        textDecoration: 'none', fontSize: 13, fontWeight: 500,
        color: active ? '#e0e0ff' : '#6b6b8a',
        borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
        paddingBottom: 2,
        transition: 'color 0.15s',
      }}>{label}</Link>
    );
  };

  const navLinks = [
    ['/', 'Tracker'],
    ['/company', 'Company'],
    ['/contracts', 'Marketplace'],
    ...(user?.role === 'admin' ? [['/admin', 'Admin']] : []),
  ];

  return (
    <>
      <nav style={{ justifyContent: 'space-between' }}>
        {/* Left: brand + links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link to="/" style={{ textDecoration: 'none' }}><div className="nav-brand">Galactic Track</div></Link>
          {!isMobile && (
            <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 20, height: 42 }}>
              {navLinks.map(([to, label]) => navLink(to, label))}
            </div>
          )}
          {isMobile && (
            <button
              className="nav-hamburger"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          )}
        </div>

        {/* Right: company name + notifications + settings */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6b6b8a', whiteSpace: 'nowrap', maxWidth: isMobile ? 80 : 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.companyName}</span>
            <NotificationBell />
            <button
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              style={{
                background: 'none', border: '1px solid #2e2e5a', borderRadius: 6,
                padding: '4px 8px', color: '#6b6b8a', fontSize: 15, cursor: 'pointer',
                lineHeight: 1, display: 'flex', alignItems: 'center',
              }}
            >
              ⚙
            </button>
          </div>
        )}
      </nav>
      {isMobile && menuOpen && (
        <div className="nav-mobile-menu">
          {navLinks.map(([to, label]) => navLink(to, label, true))}
        </div>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

// ── Document title (unread count) ────────────────────────────────────────────

function TabTitle() {
  const { unread } = useNotifications();
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Galactic-Track` : 'Galactic-Track';
  }, [unread]);
  return null;
}

// ── Page view tracker ────────────────────────────────────────────────────────

function PageTracker() {
  const location = useLocation();
  useEffect(() => {
    const p = location.pathname;
    let page;
    if (p === '/')            page = 'home';
    else if (p === '/contracts') page = 'contracts';
    else if (p === '/company')   page = 'company';
    else if (p === '/login')     page = 'login';
    else if (p === '/admin')     page = 'admin';
    else                         page = `item:${p.slice(1)}`; // item slug
    api.trackPage(page);
  }, [location.pathname]);
  return null;
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
        <NotificationsProvider>
        <BrowserRouter>
          <TabTitle />
          <PageTracker />
          <Nav />
          <main>
            <ErrorBoundary>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/contracts" element={<RequireAuth><Contracts /></RequireAuth>} />
                <Route path="/company"   element={<RequireAuth><Company /></RequireAuth>} />
                <Route path="/:slug" element={<RequireAuth><ItemDetail /></RequireAuth>} />
                <Route path="/" element={<RequireAuth><ItemGrid /></RequireAuth>} />
              </Routes>
            </ErrorBoundary>
          </main>
        </BrowserRouter>
        </NotificationsProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
