import { useEffect, useState } from "react";

/**
 * useMediaQuery
 * - Pass any CSS media query string and get a boolean that updates on change.
 * - Example: const isTablet = useMediaQuery('(min-width: 768px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return;
    const mql = window.matchMedia(query);
    const listener = () => setMatches(mql.matches);
    // Set initial
    setMatches(mql.matches);
    // Subscribe
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [query]);

  return matches;
}
