/**
 * SDD-013 §"Capa de datos": last-successful-result cache shared by every {@link useApiQuery} call, keyed
 * by the caller-supplied `key`. Deliberately an in-module `Map`, not `localStorage` — it only needs to
 * survive remounts within the same SPA session (so navigating away from a screen and back doesn't flash
 * "cargando" again), never a full page reload.
 */
const queryCache = new Map<string, unknown>();

export function getCachedQuery<T>(key: string): T | undefined {
  return queryCache.has(key) ? (queryCache.get(key) as T) : undefined;
}

export function setCachedQuery<T>(key: string, data: T): void {
  queryCache.set(key, data);
}

/** Called by {@link useApiMutation} on a successful mutation, per its `invalidate` option. */
export function invalidateQueryCache(keys: readonly string[]): void {
  for (const key of keys) queryCache.delete(key);
}

/** Test-only escape hatch: the cache above is module-level, so tests must reset it between cases. */
export function clearQueryCache(): void {
  queryCache.clear();
}
