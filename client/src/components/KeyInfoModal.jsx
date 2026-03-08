export default function KeyInfoModal({ onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1200, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0d0d22', border: '1px solid #1e1e3a', borderRadius: 12,
          padding: '28px 32px', width: '100%', maxWidth: 460,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ color: '#e0e0ff', fontSize: 15, fontWeight: 600 }}>How your key is used</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#6b6b8a', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}
          >✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid #1e1e3a', borderRadius: 8, overflow: 'hidden', maxHeight: '55vh', overflowY: 'auto' }}>
          <Row label="Access Level" badge="Limited">
            To use the tool and all features in the app we only require your Limited API Key.
          </Row>
          <Row label="What is it used for?" badge="Identity & market polling">
            Your key is used to confirm your identity and fetch your company details. If you choose
            to track a market item, your key is also used to periodically poll that item&apos;s
            public order book. Polled data is aggregated and shared with all logged-in users.
          </Row>
          <Row label="Key Storage" badge="Encrypted in database">
            Stored using <strong>AES-256-GCM</strong> encryption with a server-side secret. A one-way
            hash identifies your account. The plaintext key is never logged or returned to any client.
          </Row>
          <Row label="Data Storage" badge="Persistent (until account deletion)">
            Your account and key persist until you revoke access. Market snapshots and trade events are
            kept for <strong>30 days</strong> then automatically deleted.
          </Row>
          <Row label="Data Sharing" badge="Public aggregated statistics" last>
            Only public market data is collected — order books, prices, and trade volumes visible to
            anyone in-game. This is aggregated into dashboards shared with all logged-in users.
            No private account or company data is accessed.
          </Row>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 20, width: '100%',
            background: '#1e1440', border: '1px solid #4c1d95', borderRadius: 7,
            padding: '10px 0', color: '#a78bfa', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function Row({ label, badge, children, last }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderBottom: last ? 'none' : '1px solid #1a1a35',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b6b8a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600,
          background: '#1e1440', border: '1px solid #4c1d95',
          color: '#a78bfa', borderRadius: 4, padding: '1px 7px',
        }}>
          {badge}
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#9090b0', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}
