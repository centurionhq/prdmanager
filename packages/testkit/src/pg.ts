import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { connect, createPool, runMigrations, type PgDatabase } from '@prdm/db';
import type { Pool } from 'pg';

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
export async function openTestPg(config: PgTestConfig = testPgConfig()): Promise<PgTestDb> {
  const ownerPool = createPool({ connectionString: config.migrationUrl });
  const appPool = createPool({ connectionString: config.appUrl });
  try {
    await ownerPool.query('SELECT 1');
  } catch (err) {
    await ownerPool.end();
    await appPool.end();
    throw new Error(
      `Postgres test instance unreachable at ${config.migrationUrl}; run "docker compose --profile test up -d postgres-test" (${(err as Error).message})`,
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
 * WO-242 (genuine CI-only Postgres deadlock, `error: deadlock detected` / `40P01`, never reproduced
 * locally): a single multi-table `TRUNCATE t1, t2, ...` statement acquires an `AccessExclusiveLock` on
 * every listed table, one at a time, *in the order listed* — Postgres never reorders a `TRUNCATE`'s own
 * target list. The previous version of this query had no `ORDER BY`, so `pg_catalog.pg_tables`' row order
 * was whatever the planner's own scan of `pg_class`/`pg_namespace` happened to return — not guaranteed
 * stable, and with no relationship whatsoever to the order any *application* transaction touches those
 * same tables in. `packages/server/src/collab/doc-update-writer.ts`'s `writeDocUpdateBatch` is exactly
 * such a transaction: it always `INSERT`s into `doc_updates` first, then (conditionally) `doc_client_
 * bindings` — two different tables' `RowExclusiveLock`s acquired in one fixed order, every single time.
 * Whenever this function's own unordered scan happened to list those same two tables in the *opposite*
 * relative order, a `TRUNCATE` racing a still-committing `writeDocUpdateBatch` transaction produced a
 * textbook AB-BA lock-order deadlock: `TRUNCATE` holds table A's lock waiting on table B, while the write
 * holds table B's lock waiting on table A. Ordering by `pg_class.oid` (creation order — a table's oid is
 * assigned once, at `CREATE TABLE` time, and never changes) fixes this the same way any deadlock-avoidance
 * scheme does: by giving *every* caller (this function included) one single, stable, agreed-upon lock
 * order to follow. `doc_updates` (migration 0009) was created before `doc_client_bindings` (migration
 * 0010), so ordering by creation order here happens to line up exactly with `writeDocUpdateBatch`'s own
 * insert order — see `packages/db/tests/integration/truncate-all-lock-order.test.ts` for a deterministic,
 * non-timing-based proof (real concurrent connections: a `writeDocUpdateBatch`-shaped transaction never
 * deadlocks against a concurrent `truncateAll`). This local Postgres instance's own `pg_tables` catalog
 * scan happens to already return these two tables in creation order even *without* this fix (small,
 * never-vacuumed catalog, stable physical layout) — consistent with WO-242's own finding that this
 * deadlock never reproduced locally and only ever hit the weaker CI runner, whose catalog scan apparently
 * did return a different (colliding) order at least once.
 *
 * A retry-on-deadlock loop was deliberately not added: creation-order locking eliminates the actual
 * lock-order race between this function and every known multi-table writer in this codebase (there is
 * exactly one, `writeDocUpdateBatch`, and its own fixed order now matches) rather than merely tolerating
 * it, so a retry here would be masking a race this fix already closes.
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
