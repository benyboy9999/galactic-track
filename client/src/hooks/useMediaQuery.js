import { useState, useEffect } from 'react';

export function useMediaQuery(maxWidth) {
  const [matches, setMatches] = useState(
    () => window.matchMedia(`(max-width: ${maxWidth}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    setMatches(mq.matches);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [maxWidth]);
  return matches;
}
