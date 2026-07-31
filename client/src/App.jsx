// Site closing notice — the Galactic Track website is being sunset.
// The browser extension remains live and unaffected.

export default function App() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a18',
        color: '#e0e0f0',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          textAlign: 'center',
          background: '#0d0d22',
          border: '1px solid #1e1e3a',
          borderRadius: 12,
          padding: '40px 32px',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
          Galactic Track
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 16px', color: '#f0f0ff' }}>
          This website is closing
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#9090b0', margin: '0 0 20px' }}>
          Galactic Track is no longer available. The browser extension remains
          live and unaffected — this change only applies to the website.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#9090b0', margin: 0 }}>
          For a reliable alternative, check out{' '}
          <a
            href="https://gt-companion.com/exchange"
            style={{ color: '#a78bfa', fontWeight: 600, textDecoration: 'none' }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
          >
            gt-companion.com/exchange
          </a>
          .
        </p>
      </div>
    </div>
  );
}
