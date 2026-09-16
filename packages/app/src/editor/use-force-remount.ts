/**
 * Forces exactly one extra render right after mount. Every "portal into a block's DOM node" component in
 * this editor (`RemoteCursors.tsx`, `BlameMargin.tsx`) reads `containerRef.current` during render to find
 * its target — but a `ref` callback only runs during commit, *after* the first render already executed, so
 * that first render always sees `containerRef.current` as whatever it was before this component mounted
 * (typically `null`). Without a subsequent render, the portal target is never found the very first time
 * a marker becomes visible if nothing else happens to cause one.
 */
import { useEffect, useReducer } from 'react';

export function useForceRemount(): void {
  const [, forceRemount] = useReducer((count: number) => count + 1, 0);
  useEffect(() => forceRemount(), []);
}
