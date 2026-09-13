import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.js';

export interface PgConfig {
  /** `postgres://user:password@host:port/database`; the app connects as `prdm_app` (SDD-006 §Aislamiento). */
  connectionString: string;
  /** Defaults to 10; kept small since the MVP runs a single server instance (ADR-006). */
  maxConnections?: number;
}

export type PgDatabase = NodePgDatabase<typeof schema>;

/**
 * Creates a `pg` connection pool from an already-validated config. Building a `Pool` never opens a
 * socket by itself (`pg` connects lazily on the first query), so this is safe to call from unit tests
 * without a reachable database.
 */
export function createPool(config: PgConfig): Pool {
  const options: PoolConfig = {
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
  };
  return new Pool(options);
}

/** Wraps a pool with the Drizzle query builder bound to this package's (still empty) schema. */
export function connect(pool: Pool): PgDatabase {
  return drizzle(pool, { schema });
}
