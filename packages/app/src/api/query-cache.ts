/**
 * SDD-013 §"Capa de datos": last-successful-result cache shared by every {@link useApiQuery} call, keyed
 * by the caller-supplied `key`. Deliberately an in-module `Map`, not `localStorage` — it only needs to
 * survive remounts within the same SPA session (so navigating away from a screen and back doesn't flash
 * "cargando" again), never a full page reload.
 *
 * SDD-103 D6: storing a value is not the same as it being reusable. `request.ts` casts the response body
 * without validating it, so a 200 whose envelope the screen cannot render reaches this cache and the render
 * throws inside the route's `errorElement`. Retrying there is `navigate(location, { replace: true })` — a
 * remount with the *same* query key — so serving that value again would throw a second time before the
 * refetch effect ever ran: zero requests, the plate back, the app broken until a full reload (WO-744's own
 * gate caught exactly that). Hence `setCachedQuery` stores the value **unconfirmed**, and only a render that
 * actually committed confirms it ({@link confirmQueryRendered}) — a tree that throws never commits.
 */
const queryCache = new Map<string, unknown>();
const confirmedKeys = new Set<string>();

/** Raw stored value, confirmed or not — screens must read through {@link getRenderableQuery}. */
export function getCachedQuery<T>(key: string): T | undefined {
  return queryCache.has(key) ? (queryCache.get(key) as T) : undefined;
}

/** The stored value for `key` *only* once a render with it on screen has committed; otherwise `undefined`,
 * exactly as if it had never been fetched. */
export function getRenderableQuery<T>(key: string): T | undefined {
  return confirmedKeys.has(key) ? getCachedQuery<T>(key) : undefined;
}

export function setCachedQuery<T>(key: string, data: T): void {
  queryCache.set(key, data);
  // A value that has not been on screen yet cannot be reused: it must prove itself in a commit first.
  confirmedKeys.delete(key);
}

/** Called by {@link useApiQuery} after a commit that rendered `key`'s value without throwing. */
export function confirmQueryRendered(key: string): void {
  if (queryCache.has(key)) confirmedKeys.add(key);
}

/** Called by {@link useApiMutation} on a successful mutation, per its `invalidate` option. */
export function invalidateQueryCache(keys: readonly string[]): void {
  for (const key of keys) {
    queryCache.delete(key);
    confirmedKeys.delete(key);
  }
}

/** Test-only escape hatch: the cache above is module-level, so tests must reset it between cases. */
export function clearQueryCache(): void {
  queryCache.clear();
  confirmedKeys.clear();
}
