import { useState, useEffect, useCallback } from 'react';

const BASE = '/api/admin';

// ── Admin API helpers ─────────────────────────────────────────────────────────

function adminFetch(path, token, options = {}) {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(iso) {
  if (!iso) return '—';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 120)  return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Table({ cols, rows, emptyMsg = 'No data' }) {
  if (!rows.length) {
    return <p style={{ color: '#4a4a6a', fontSize: 13, margin: 0 }}>{emptyMsg}</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} style={{ textAlign: 'left', padding: '6px 10px', color: '#6b6b8a', fontWeight: 500, borderBottom: '1px solid #1e1e3a', whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #13132a' }}>
              {cols.map((c) => (
                <td key={c.key} style={{ padding: '7px 10px', color: '#c4c4e0', verticalAlign: 'top' }}>
                  {c.render ? c.render(row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Btn({ children, onClick, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: danger ? '#7f1d1d' : '#1e1e3a',
        color: danger ? '#fca5a5' : '#a78bfa',
        border: `1px solid ${danger ? '#dc2626' : '#2e2e5a'}`,
        borderRadius: 4,
        padding: '3px 10px',
        fontSize: 11,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }) {
  const [pw, setPw]       = useState('');
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Login failed');
      sessionStorage.setItem('adminToken', body.token);
      onLogin(body.token);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: 32, width: 320 }}>
        <h1 style={{ margin: '0 0 24px', fontSize: 18, color: '#e0e0ff' }}>Admin Access</h1>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            style={{ background: '#13132a', border: '1px solid #2e2e5a', borderRadius: 4, padding: '9px 12px', color: '#e0e0ff', fontSize: 14 }}
          />
          {err && <p style={{ margin: 0, color: '#f87171', fontSize: 13 }}>{err}</p>}
          <button
            type="submit"
            disabled={loading || !pw}
            style={{ background: '#4c1d95', color: '#e0e0ff', border: 'none', borderRadius: 4, padding: '9px 0', fontSize: 14, cursor: 'pointer' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function Dashboard({ token, onLogout }) {
  const [users,     setUsers]     = useState([]);
  const [items,     setItems]     = useState([]);
  const [rates,     setRates]     = useState([]);
  const [errors,    setErrors]    = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState('');
  const [tab,       setTab]       = useState('users');
  const [working,   setWorking]   = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, it, rl, er, co] = await Promise.all([
        adminFetch('/users',         token),
        adminFetch('/tracked-items', token),
        adminFetch('/rate-limits',   token),
        adminFetch('/errors',        token),
        adminFetch('/contracts',     token),
      ]);
      setUsers(u);
      setItems(it);
      setRates(rl);
      setErrors(er);
      setContracts(co);
      setErr('');
    } catch (e) {
      if (e.message.includes('Invalid admin token')) {
        sessionStorage.removeItem('adminToken');
        onLogout();
      } else {
        setErr(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => { load(); }, [load]);

  async function revokeUser(userId) {
    if (!confirm('Revoke this user? Their items will stop polling.')) return;
    setWorking(userId);
    try {
      await adminFetch(`/revoke/${userId}`, token, { method: 'POST' });
      await load();
    } catch (e) { alert(e.message); }
    finally { setWorking(null); }
  }

  async function adjustCredits(userId, delta) {
    setWorking(`credits-${userId}`);
    try {
      await adminFetch(`/users/${userId}/credits`, token, {
        method: 'PATCH',
        body: JSON.stringify({ delta }),
      });
      await load();
    } catch (e) { alert(e.message); }
    finally { setWorking(null); }
  }

  async function untrackItem(matId) {
    if (!confirm('Disable this item? The credit will be refunded to its owner.')) return;
    setWorking(matId);
    try {
      await adminFetch(`/untrack/${matId}`, token, { method: 'POST' });
      await load();
    } catch (e) { alert(e.message); }
    finally { setWorking(null); }
  }

  async function removeContract(id) {
    if (!confirm('Force-remove this listing?')) return;
    setWorking(`contract-${id}`);
    try {
      await adminFetch(`/contracts/${id}`, token, { method: 'DELETE' });
      await load();
    } catch (e) { alert(e.message); }
    finally { setWorking(null); }
  }

  async function logout() {
    try { await adminFetch('/logout', token, { method: 'POST' }); } catch { /* ok */ }
    sessionStorage.removeItem('adminToken');
    onLogout();
  }

  const tabStyle = (t) => ({
    padding: '6px 14px',
    fontSize: 12,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: tab === t ? '#2e1e6a' : 'transparent',
    color: tab === t ? '#a78bfa' : '#6b6b8a',
    fontWeight: tab === t ? 600 : 400,
  });

  const userCols = [
    { key: 'company_name', label: 'Company' },
    { key: 'credits_used', label: 'Credits', render: (r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.credits_used}/{r.credits_total ?? 3}</span>
        <button
          onClick={() => adjustCredits(r.id, -1)}
          disabled={working === `credits-${r.id}` || (r.credits_total ?? 3) <= 1}
          title="Decrease limit"
          style={{ background: 'none', border: '1px solid #2e2e5a', borderRadius: 3, color: '#6b6b8a', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '1px 5px' }}
        >−</button>
        <button
          onClick={() => adjustCredits(r.id, 1)}
          disabled={working === `credits-${r.id}`}
          title="Increase limit"
          style={{ background: 'none', border: '1px solid #2e2e5a', borderRadius: 3, color: '#6b6b8a', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '1px 5px' }}
        >+</button>
      </div>
    )},
    { key: 'revoked',      label: 'Status', render: (r) => (
      <span style={{ color: r.revoked ? '#f87171' : '#34d399' }}>{r.revoked ? 'revoked' : 'active'}</span>
    )},
    { key: 'tracked_items', label: 'Items', render: (r) => (r.tracked_items ?? []).map((i) => i.matName).join(', ') || '—' },
    { key: 'last_seen',    label: 'Last seen', render: (r) => fmtAgo(r.last_seen) },
    { key: 'registered_at', label: 'Joined', render: (r) => fmtDate(r.registered_at) },
    { key: '_actions',     label: '', render: (r) => (
      !r.revoked && <Btn danger onClick={() => revokeUser(r.id)} disabled={working === r.id}>Revoke</Btn>
    )},
  ];

  const itemCols = [
    { key: 'mat_name',   label: 'Item' },
    { key: 'owner',      label: 'Owner' },
    { key: 'active',     label: 'Status', render: (r) => (
      <span style={{ color: r.active ? '#34d399' : '#6b6b8a' }}>{r.active ? 'active' : 'inactive'}</span>
    )},
    { key: 'last_snapshot_at', label: 'Last poll', render: (r) => fmtAgo(r.last_snapshot_at) },
    { key: 'enabled_at', label: 'Enabled', render: (r) => fmtDate(r.enabled_at) },
    { key: '_actions',   label: '', render: (r) => (
      r.active && <Btn danger onClick={() => untrackItem(r.mat_id)} disabled={working === r.mat_id}>Disable</Btn>
    )},
  ];

  const rateCols = [
    { key: 'companyName', label: 'Company' },
    { key: 'remaining',   label: 'Remaining', render: (r) => `${r.remaining} / ${r.totalBudget}` },
    { key: 'resetIn',     label: 'Reset in', render: (r) => `${r.resetIn}s` },
    { key: 'ourSpend',    label: 'Our spend', render: (r) => r.ourSpend ?? '—' },
  ];

  const errorCols = [
    { key: 'at',      label: 'Time',  render: (r) => fmtDate(r.at) },
    { key: 'item',    label: 'Item' },
    { key: 'message', label: 'Error' },
  ];

  const contractCols = [
    { key: 'company_name', label: 'Company' },
    { key: 'type',         label: 'Type',   render: (r) => (
      <span style={{ color: r.type === 'buy' ? '#34d399' : '#f87171' }}>{r.type}</span>
    )},
    { key: 'mat_name',     label: 'Item' },
    { key: 'planet',       label: 'Location' },
    { key: 'max_daily_qty', label: 'Qty/day', render: (r) => Number(r.max_daily_qty).toLocaleString() },
    { key: 'status',       label: 'Status', render: (r) => (
      <span style={{ color: r.active ? '#34d399' : '#6b6b8a' }}>{r.status}</span>
    )},
    { key: 'created_at',   label: 'Posted',  render: (r) => fmtAgo(r.created_at) },
    { key: 'bumped_at',    label: 'Bumped',  render: (r) => fmtAgo(r.bumped_at) },
    { key: '_actions',     label: '',        render: (r) => (
      r.active && (
        <Btn danger onClick={() => removeContract(r.id)} disabled={working === `contract-${r.id}`}>
          Remove
        </Btn>
      )
    )},
  ];

  const activeContracts = contracts.filter((c) => c.active);

  if (loading) return <p style={{ color: '#6b6b8a', padding: 32 }}>Loading…</p>;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#e0e0ff' }}>Admin Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {err && <span style={{ color: '#f87171', fontSize: 12 }}>{err}</span>}
          <Btn onClick={load}>Refresh</Btn>
          <Btn onClick={logout}>Sign out</Btn>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Users',           value: users.length },
          { label: 'Active',          value: users.filter((u) => !u.revoked).length },
          { label: 'Tracked items',   value: items.filter((i) => i.active).length },
          { label: 'Active listings', value: contracts.filter((c) => c.active).length },
          { label: 'Recent errors',   value: errors.length },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 6, padding: '10px 16px', flex: 1 }}>
            <div style={{ fontSize: 11, color: '#6b6b8a', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: '#e0e0ff' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 6, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'users',     label: `Users (${users.length})` },
          { key: 'items',     label: `Items (${items.length})` },
          { key: 'contracts', label: `Listings (${activeContracts.length})` },
          { key: 'rates',     label: 'Rate Limits' },
          { key: 'errors',    label: `Errors (${errors.length})` },
        ].map(({ key, label }) => (
          <button key={key} style={tabStyle(key)} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 8, padding: '16px 20px' }}>
        {tab === 'users'     && <Table cols={userCols}     rows={users}     emptyMsg="No users registered" />}
        {tab === 'items'     && <Table cols={itemCols}     rows={items}     emptyMsg="No tracked items" />}
        {tab === 'contracts' && <Table cols={contractCols} rows={contracts} emptyMsg="No listings" />}
        {tab === 'rates'     && <Table cols={rateCols}     rows={rates}     emptyMsg="No rate limit data yet" />}
        {tab === 'errors'    && <Table cols={errorCols}    rows={errors}    emptyMsg="No errors recorded" />}
      </div>
    </div>
  );
}

// ── Page entry point ──────────────────────────────────────────────────────────

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('adminToken') ?? '');

  if (!token) return <LoginForm onLogin={setToken} />;
  return <Dashboard token={token} onLogout={() => setToken('')} />;
}
