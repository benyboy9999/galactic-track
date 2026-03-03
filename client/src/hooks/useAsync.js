import { useState, useEffect, useCallback, useRef } from 'react';

export function useAsync(fn, deps = [], { lazy = false } = {}) {
  const lazyRef = useRef(lazy);
  const [state, setState] = useState({ data: null, loading: !lazy, error: null });

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: err.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { if (!lazyRef.current) run(); }, [run]);

  return { ...state, refresh: run };
}
