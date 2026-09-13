import type { PrdmDeps } from './deps.js';

/**
 * SDD-002 "Transacción atómica": a write always recovers first (replays any orphaned journal, refreshes a graph
 * left stale by a crashed process) because `engine.transaction()` calls it internally; a read never goes through
 * `transaction()`, so without this it could silently serve stale data after a crash. Every read tool/resource/
 * prompt handler calls this before touching `deps.store`/`deps.authoring`. Isolated in one place so a future
 * signature change to the underlying `engine.recover()` only needs one call site updated.
 */
export async function ensureRecovered(deps: PrdmDeps): Promise<void> {
  await deps.engine.recover();
}
