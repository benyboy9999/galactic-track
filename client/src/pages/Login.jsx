import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const IS_DEV = import.meta.env.DEV;

export default function Login() {
  const [apiKey,  setApiKey]  = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate  = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const data = await api.login(apiKey.trim());
      login(data.sessionToken, data.companyName, data.creditsUsed, data.creditsTotal);
      navigate('/', { replace: true });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 10, padding: '36px 40px', width: 380 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 22, color: '#e0e0ff' }}>Galactic Track</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#6b6b8a' }}>Provide A Public API Key</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#13132a',
                border: '1px solid #2e2e5a',
                borderRadius: 5,
                padding: '10px 12px',
                color: '#e0e0ff',
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
          </div>

          {err && (
            <p style={{ margin: 0, padding: '8px 12px', background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 4, color: '#f87171', fontSize: 13 }}>
              {err}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            style={{
              background: loading || !apiKey.trim() ? '#2e1e6a' : '#4c1d95',
              color: '#e0e0ff',
              border: 'none',
              borderRadius: 5,
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

        {IS_DEV && (
          <button
            onClick={async () => {
              setLoading(true);
              setErr('');
              try {
                const data = await api.devLogin();
                login(data.sessionToken, data.companyName, data.creditsUsed, data.creditsTotal);
                navigate('/', { replace: true });
              } catch (e) {
                setErr(e.message);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{
              marginTop: 12, width: '100%', background: 'none',
              border: '1px dashed #2e2e5a', borderRadius: 5, padding: '8px 0',
              color: '#3a3a55', fontSize: 12, cursor: 'pointer',
            }}
          >
            Dev login (local only)
          </button>
        )}
      </div>
    </div>
  );
}
