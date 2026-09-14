import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase } from './pool.js';

/**
 * Resolved relative to this module's own file (works from both `src/` under `tsx --conditions=@prdm/source`
 * and the compiled `dist/`, since both sit one level under `packages/db/`), never `process.cwd()`.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies every migration under `migrations/` (drizzle-kit's own tracking table lives in a separate
 * `drizzle` schema, so it never collides with `packages/testkit`'s truncation of `public`). Safe to call
 * with the empty baseline this package ships today (WO-087/WO-090): zero entries in
 * `migrations/meta/_journal.json` means this is a no-op. Must run with `prdm_owner` credentials
 * (SDD-006 §Aislamiento: migrations never run as `prdm_app`).
 */
export async function runMigrations(db: PgDatabase, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder });
}
