import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { connect, createPool, runMigrations, type PgDatabase } from '@prdm/db';
import type { Pool } from 'pg';
import { assertDbAllowed } from './guard.js';

const ROOT_ENV_FILE = join(process.cwd(), '.env');

export interface PgTestConfig {
  /** `prdm_owner` credentials: runs migrations and truncation (SDD-006 §Aislamiento — never `prdm_app`). */
  migrationUrl: string;
  /** `prdm_app` credentials: what the actual test assertions connect as, same as the server would. */
  appUrl: string;
}

/**
 * Reads `DATABASE_TEST_MIGRATION_URL`/`DATABASE_TEST_URL` (5433, `docker compose --profile test up -d
 * postgres-test`), refusing to run if either one is missing or equals the corresponding development URL —
 * same guard as `testConfig`/`openTestDb` in `db.ts` for Neo4j, since these tests truncate every table.
 */
export function testPgConfig(): PgTestConfig {
  // Local port overrides (PRDM_POSTGRES_TEST_PORT) live in the repo's .env; loadEnvFile never overrides variables
  // already set in the real environment, so CI's service URLs still win.
  if ((!process.env.DATABASE_TEST_MIGRATION_URL || !process.env.DATABASE_TEST_URL) && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  const migrationUrl = process.env.DATABASE_TEST_MIGRATION_URL;
  const appUrl = process.env.DATABASE_TEST_URL;
  if (!migrationUrl || !appUrl) {
    throw new Error(
      'DATABASE_TEST_MIGRATION_URL and DATABASE_TEST_URL must be set (see .env.example); run "docker compose --profile test up -d postgres-test"',
    );
  }
  if (migrationUrl === process.env.DATABASE_MIGRATION_URL || appUrl === process.env.DATABASE_URL) {
    throw new Error('refusing to run destructive tests against the development Postgres instance');
  }
  return { migrationUrl, appUrl };
}

export interface PgTestDb {
  /** `prdm_owner` pool: use for schema setup/teardown a test needs beyond what `openTestPg` already did. */
  ownerPool: Pool;
  /** `prdm_app` pool, wrapped with Drizzle — what most assertions should read/write through. */
  db: PgDatabase;
  appPool: Pool;
  close(): Promise<void>;
}

/**
 * Connects to the shared test Postgres instance, applies every pending migration once (idempotent, safe to
 * call from every test file since `fileParallelism: false` runs them one at a time), truncates whatever the
 * previous run of the same fixture left behind, and returns both pools plus an app-scoped Drizzle instance.
 */
export async function openTestPg(config?: PgTestConfig): Promise<PgTestDb> {
  assertDbAllowed();
  const resolvedConfig = config ?? testPgConfig();
  const ownerPool = createPool({ connectionString: resolvedConfig.migrationUrl });
  const appPool = createPool({ connectionString: resolvedConfig.appUrl });
  try {
    await ownerPool.query('SELECT 1');
  } catch (err) {
    await ownerPool.end();
    await appPool.end();
    throw new Error(
      `Postgres test instance unreachable at ${resolvedConfig.migrationUrl}; run "docker compose --profile test up -d postgres-test" (${(err as Error).message})`,
    );
  }
  await runMigrations(connect(ownerPool));
  await truncateAll(ownerPool);
  return {
    ownerPool,
    appPool,
    db: connect(appPool),
    close: async () => {
      await appPool.end();
      await ownerPool.end();
    },
  };
}

/**
 * Truncates every table in the `public` schema (where `packages/db`'s own schema lives, once it has any)
 * with `RESTART IDENTITY CASCADE`, skipping nothing on purpose — drizzle-kit's own migration bookkeeping
 * table lives in a separate `drizzle` schema (see `packages/db/src/migrate.ts`), so it's never in this list.
 * A no-op today: there are no tables yet (WO-090 only scaffolds the harness).
 *
 * WO-242/WO-244 (genuine CI-only Postgres deadlock, `error: deadlock detected` / `40P01`, never reproduced
 * locally under normal timing): a single multi-table `TRUNCATE t1, t2, ...` statement acquires an
 * `AccessExclusiveLock` on every *listed* table, one at a time, strictly in the textual order the
 * statement lists them — confirmed directly (two real concurrent connections, `pg_locks` inspected mid-
 * statement) rather than assumed; Postgres does not reorder a `TRUNCATE`'s own target list by oid or
 * anything else. Ordering this query's own table list by `pg_class.oid` (creation order, stable for a
 * table's lifetime) exists so that *some* single, agreed-upon lock order exists for every caller to match —
 * `truncateAll` itself is one of only two things fighting over each pair of tables it truncates; the other
 * is whatever application transaction ever touches more than one of the same tables in one transaction.
 *
 * WO-242 originally (and wrongly) identified the CI failure's two relation OIDs as `doc_updates`/
 * `doc_client_bindings` and only checked that pair's ordering. The very next real CI run reproduced the
 * *same* deadlock with the *same* OIDs, proving that theory false: those OIDs are actually `documents`
 * and `doc_updates` (`doc_client_bindings` was never involved). The real conflicting transaction was
 * `packages/server/src/collab/persistence.ts`'s `onStoreDocument`, which used to `SELECT` from
 * `doc_updates` and only then `UPDATE documents` — the exact reverse of `truncateAll`'s own oid order
 * (`documents`, oid 16935, was created before `doc_updates`, oid 17071, in this schema). WO-244 fixed
 * `onStoreDocument` itself to touch `documents` first (see that file's own comment) rather than changing
 * anything here — this function's oid ordering was already correct, and reproducing the deadlock (real,
 * induced-delay, concurrent connections; see `packages/db/tests/integration/
 * documents-doc-updates-lock-order.test.ts`) confirmed it was the *other* side that had to change.
 *
 * A retry-on-deadlock loop was deliberately not added: fixing the one offending transaction's own lock
 * order eliminates the race rather than merely tolerating it, so a retry here would mask a bug this fix
 * already closes. Any *future* multi-table writer added to this codebase must follow the same rule —
 * acquire locks on more than one of these tables in ascending `pg_class.oid` order — or it will deadlock
 * against this function the same way.
 */
export async function truncateAll(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT c.relname AS tablename
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.oid`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
