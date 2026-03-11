import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import KeyInfoModal from '../components/KeyInfoModal';

const IS_DEV = import.meta.env.DEV;

const Logo = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="52" height="52">
    <rect width="32" height="32" rx="7" fill="#0d0d22"/>
    <rect x="5" y="18" width="4" height="8" rx="1" fill="#f87171"/>
    <line x1="7" y1="14" x2="7" y2="18" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="7" y1="26" x2="7" y2="28" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
    <rect x="12" y="10" width="4" height="10" rx="1" fill="#34d399"/>
    <line x1="14" y1="6" x2="14" y2="10" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="14" y1="20" x2="14" y2="23" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round"/>
    <rect x="19" y="14" width="4" height="9" rx="1" fill="#a78bfa"/>
    <line x1="21" y1="10" x2="21" y2="14" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="21" y1="23" x2="21" y2="26" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M25 5 Q30 10 27 16" stroke="#3b3b6a" strokeWidth="1" fill="none" strokeLinecap="round"/>
    <circle cx="27" cy="16" r="1.5" fill="#a78bfa"/>
  </svg>
);

export default function Login() {
  const [apiKey,    setApiKey]    = useState('');
  const [err,       setErr]       = useState('');
  const [loading,   setLoading]   = useState(false);
  const [showInfo,  setShowInfo]  = useState(false);
  const { login } = useAuth();
  const navigate  = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const data = await api.login(apiKey.trim());
      login(data.sessionToken, data.companyName, data.creditsUsed, data.creditsTotal, data.id, data.role);
      navigate('/', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDevLogin() {
    setLoading(true);
    setErr('');
    try {
      const data = await api.devLogin();
      login(data.sessionToken, data.companyName, data.creditsUsed, data.creditsTotal, data.id);
      navigate('/', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
        <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 12, padding: '36px 40px', width: 'min(380px, 95vw)' }}>

          {/* Logo + brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
            <Logo />
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#e0e0ff', letterSpacing: '-0.02em' }}>
                Galactic Track
              </div>
              <div style={{ fontSize: 12, color: '#6b6b8a', marginTop: 2 }}>
                Market intelligence for Galactic Tycoons
              </div>
              <div style={{ fontSize: 11, color: '#4a4a7a', marginTop: 3 }}>
                Now includes a new contract marketplace
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #1a1a35', marginBottom: 24 }} />

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Limited API Key
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your key…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#13132a',
                border: '1px solid #2e2e5a',
                borderRadius: 6,
                padding: '10px 12px',
                color: '#e0e0ff',
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />

            {err && (
              <p style={{ margin: 0, padding: '8px 12px', background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 4, color: '#f87171', fontSize: 13 }}>
                {err}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !apiKey.trim()}
              style={{
                marginTop: 4,
                background: loading || !apiKey.trim() ? '#2e1e6a' : '#4c1d95',
                color: '#e0e0ff',
                border: 'none',
                borderRadius: 6,
                padding: '11px 0',
                fontSize: 14,
                fontWeight: 500,
                cursor: loading || !apiKey.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {loading ? 'Connecting…' : 'Connect'}
            </button>
          </form>

          {/* Info link */}
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button
              onClick={() => setShowInfo(true)}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: '#4a4a7a', fontSize: 12, cursor: 'pointer',
                textDecoration: 'underline', textUnderlineOffset: 3,
              }}
            >
              How is my key used &amp; stored?
            </button>
          </div>

          {IS_DEV && (
            <button
              onClick={handleDevLogin}
              disabled={loading}
              style={{
                marginTop: 10, width: '100%', background: 'none',
                border: '1px dashed #2e2e5a', borderRadius: 5, padding: '8px 0',
                color: '#3a3a55', fontSize: 12, cursor: 'pointer',
              }}
            >
              Dev login (local only)
            </button>
          )}
        </div>
      </div>

      {showInfo && <KeyInfoModal onClose={() => setShowInfo(false)} />}
    </>
  );
}
