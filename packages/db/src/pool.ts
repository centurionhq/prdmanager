import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.js';

export interface PgConfig {
  /** `postgres://user:password@host:port/database`; the app connects as `prdm_app` (SDD-006 §Aislamiento). */
  connectionString: string;
  /** Defaults to 10; kept small since the MVP runs a single server instance (ADR-006). */
  maxConnections?: number;
  /**
   * How long to wait for a free pooled connection before failing with `timeout exceeded when trying to connect`.
   * Defaults to 5 s; `0` means "no cap" (`pg` semantics: wait forever — the hang WO-645 · SDD-073 exists to remove).
   */
  connectionTimeoutMillis?: number;
  /** Server-side per-statement cap (`statement_timeout`). Defaults to 30 s; `0` means "no cap". */
  statementTimeoutMillis?: number;
  /**
   * Server-side cap on a transaction left idle (`idle_in_transaction_session_timeout`), so a forgotten transaction
   * stops holding a connection. Defaults to 60 s; `0` means "no cap".
   */
  idleInTransactionSessionTimeoutMillis?: number;
}

export const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 5_000;
export const DEFAULT_STATEMENT_TIMEOUT_MILLIS = 30_000;
export const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MILLIS = 60_000;

function resolveTimeoutMillis(field: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer, got ${value}`);
  }
  return value;
}

export type PgDatabase = NodePgDatabase<typeof schema>;

/**
 * Creates a `pg` connection pool from an already-validated config. Building a `Pool` never opens a
 * socket by itself (`pg` connects lazily on the first query), so this is safe to call from unit tests
 * without a reachable database.
 *
 * Waiting is always bounded by default (WO-645 · SDD-073 D1): `pg` would otherwise wait forever for a free
 * connection, which surfaced as a read hanging until the MCP client gave up at 300 s with nothing in the server log.
 */
export function createPool(config: PgConfig): Pool {
  const options: PoolConfig = {
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    connectionTimeoutMillis: resolveTimeoutMillis(
      'connectionTimeoutMillis',
      config.connectionTimeoutMillis,
      DEFAULT_CONNECTION_TIMEOUT_MILLIS,
    ),
    statement_timeout: resolveTimeoutMillis(
      'statementTimeoutMillis',
      config.statementTimeoutMillis,
      DEFAULT_STATEMENT_TIMEOUT_MILLIS,
    ),
    idle_in_transaction_session_timeout: resolveTimeoutMillis(
      'idleInTransactionSessionTimeoutMillis',
      config.idleInTransactionSessionTimeoutMillis,
      DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MILLIS,
    ),
  };
  return new Pool(options);
}

/** Wraps a pool with the Drizzle query builder bound to this package's (still empty) schema. */
export function connect(pool: Pool): PgDatabase {
  return drizzle(pool, { schema });
}
