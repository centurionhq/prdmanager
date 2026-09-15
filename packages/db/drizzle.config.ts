import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` reads this to diff `./src/schema.ts` against `./migrations` and emit new SQL;
 * `drizzle-kit migrate` (and the app's own migrator in `src/migrate.ts`) apply what's already generated.
 * The connection string is only needed for `migrate`/`push`/`studio`, never for `generate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? 'postgres://127.0.0.1:5432/prdm',
  },
});
