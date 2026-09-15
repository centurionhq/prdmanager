/**
 * A `window.matchMedia` subscription (WO-311), local to this feature since `src/lib` doesn't have
 * one. Falls back to `false` (desktop) when `matchMedia` isn't available, so it stays jsdom-safe
 * for tests that never mock it.
 */
import { useEffect, useState } from 'react';

function readMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatches(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQueryList = window.matchMedia(query);
    const handleChange = (): void => setMatches(mediaQueryList.matches);
    handleChange();
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
