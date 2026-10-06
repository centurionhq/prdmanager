import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connect, DEFAULT_STATEMENT_TIMEOUT_MILLIS, type PgDatabase } from './pool.js';

/**
 * Runs `fn` inside a single Postgres transaction on `pool` (always the `prdm_app` pool in
 * production — SDD-006 §Aislamiento: "no existe ningún pool sin RLS en el servidor") with
 * `app.org_id` fixed for that transaction via `set_config(..., true)` (the `true` "is_local" flag,
 * not a session-wide `SET`), which every RLS policy in `packages/db/src/schema/projects.ts` reads
 * through `current_setting('app.org_id', true)`.
 *
 * Scoping the setting to the transaction (rather than the session) matters for pooled connections:
 * once the transaction commits or rolls back, Postgres resets `app.org_id` on that same underlying
 * connection before it's handed back to the pool, so a later transaction that forgets to call
 * `withTenantTx` again sees no leftover tenant (`packages/db/tests/integration/tenant.test.ts`
 * exercises this directly with a pool of size 1).
 *
 * The same round trip also anchors `statement_timeout` to the transaction scope (WO-645 · SDD-073). The pool-level
 * value `createPool` sets is a session parameter: it holds only while nobody resets it on that connection and only
 * for pools built by `createPool`. Fixing it here with `set_config(..., true)` makes the cap apply to any pool
 * handed to `withTenantTx`; a pool built with `statement_timeout: false` opted out explicitly, so it's left alone.
 * `set_config` is used instead of `SET LOCAL` because `SET` can't take bind parameters.
 */
export async function withTenantTx<T>(pool: Pool, orgId: string, fn: (tx: PgDatabase) => Promise<T>): Promise<T> {
  const db = connect(pool);
  return db.transaction(async (tx) => {
    const configured = pool.options.statement_timeout;
    if (configured === false) {
      await tx.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
    } else {
      const statementTimeout = String(configured ?? DEFAULT_STATEMENT_TIMEOUT_MILLIS);
      await tx.execute(
        sql`SELECT set_config('app.org_id', ${orgId}, true), set_config('statement_timeout', ${statementTimeout}, true)`,
      );
    }
    return fn(tx);
  });
}
