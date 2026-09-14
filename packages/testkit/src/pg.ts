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
 */
export async function truncateAll(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
