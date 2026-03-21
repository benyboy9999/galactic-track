import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

// Shared dev-only company search/impersonation widget.
// Props:
//   onSelect(companyName, companyId) — called when a result is clicked
//   disabled — disables the input

export default function DevCompanySearch({ onSelect, disabled }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef     = useRef(null);

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await api.devSearch(query);
        setResults(rows);
        setOpen(rows.length > 0);
      } catch { setResults([]); setOpen(false); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSelect(row) {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(row.company_name, row.company_id, row.company_tag ?? '');
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="Search registered companies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          disabled={disabled}
          autoComplete="off"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#13132a', border: '1px solid #2e2e5a',
            borderRadius: 5, padding: '7px 30px 7px 10px',
            color: '#e0e0ff', fontSize: 12, fontFamily: 'monospace',
          }}
        />
        {loading && (
          <span style={{
            position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
            color: '#3a3a55', fontSize: 11,
          }}>…</span>
        )}
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: '#0d0d22', border: '1px solid #2e2e5a', borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          {results.map((row) => (
            <button
              key={row.company_id}
              onMouseDown={() => handleSelect(row)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', padding: '8px 12px', background: 'none',
                border: 'none', borderBottom: '1px solid #13132a',
                color: '#9090b0', fontSize: 12, cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#0f0f28'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              <span style={{ color: '#c0c0d8' }}>{row.company_name}</span>
              <span style={{ color: '#3a3a55', fontSize: 11 }}>id: {row.company_id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
