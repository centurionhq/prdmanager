import { createPool, withTenantTx, type PgConfig } from '@prdm/db';
import { assertDbAllowed, testPgConfig } from '@prdm/testkit';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, test } from 'vitest';

// WO-645 · SDD-073 D1: these tests never touch the schema (no openTestPg/truncateAll), they only prove that the
// pool bounds its waiting. Every test owns its pool so a held connection can't leak into another test.
const NIL_ORG = '00000000-0000-0000-0000-000000000000';
const SLEEP_SECONDS = 2;
const BOUNDED_MS = 1500;

let appUrl: string;

beforeAll(() => {
  assertDbAllowed();
  appUrl = testPgConfig().appUrl;
});

async function withPool<T>(overrides: Partial<PgConfig>, fn: (pool: ReturnType<typeof createPool>) => Promise<T>): Promise<T> {
  const pool = createPool({ connectionString: appUrl, ...overrides });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

function sleepInTenantTx(pool: ReturnType<typeof createPool>): Promise<unknown> {
  return withTenantTx(pool, NIL_ORG, (tx) => tx.execute(sql`SELECT pg_sleep(${SLEEP_SECONDS})`));
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function errorText(error: unknown): string {
  const err = error as { message?: string; cause?: { message?: string } };
  return `${err.message ?? ''} ${err.cause?.message ?? ''}`;
}

describe('pool timeouts against a real Postgres (WO-645 · SDD-073)', () => {
  test('acquiring a connection from a saturated pool fails within connectionTimeoutMillis', async () => {
    await withPool({ maxConnections: 1, connectionTimeoutMillis: 250 }, async (pool) => {
      const held = await pool.connect();
      try {
        const startedAt = Date.now();
        await expect(pool.query('SELECT 1')).rejects.toThrow(/timeout exceeded when trying to connect/);
        const elapsed = Date.now() - startedAt;
        expect(elapsed).toBeGreaterThanOrEqual(200);
        expect(elapsed).toBeLessThan(BOUNDED_MS);
      } finally {
        held.release();
      }
    });
  });

  test('statement_timeout cancels a long statement inside withTenantTx', async () => {
    await withPool({ statementTimeoutMillis: 250 }, async (pool) => {
      const startedAt = Date.now();
      expect(errorText(await rejectionOf(sleepInTenantTx(pool)))).toMatch(/statement timeout/);
      expect(Date.now() - startedAt).toBeLessThan(BOUNDED_MS);
    });
  });

  test('withTenantTx re-anchors statement_timeout even if the session was reset to no cap', async () => {
    await withPool({ statementTimeoutMillis: 250, maxConnections: 1 }, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 0');
      } finally {
        client.release();
      }
      const startedAt = Date.now();
      expect(errorText(await rejectionOf(sleepInTenantTx(pool)))).toMatch(/statement timeout/);
      expect(Date.now() - startedAt).toBeLessThan(BOUNDED_MS);
    });
  });

  test('idle_in_transaction_session_timeout kills a transaction left idle', async () => {
    await withPool({ idleInTransactionSessionTimeoutMillis: 500 }, async (pool) => {
      // The server kills the session (25P03) while drizzle holds the client. drizzle's own ROLLBACK then fails with
      // "Client has encountered a connection error" and masks the server's reason, so the reason is read from the
      // client's 'error' event (also required: `pg` only listens for it on idle clients) and from the statement
      // that hit the dead connection, inside the callback.
      const seen: string[] = [];
      pool.on('connect', (client) => client.on('error', (e) => seen.push(errorText(e))));
      const outer = await rejectionOf(
        withTenantTx(pool, NIL_ORG, async (tx) => {
          await tx.execute(sql`SELECT 1`);
          await new Promise((resolve) => setTimeout(resolve, 1200));
          seen.push(errorText(await rejectionOf(tx.execute(sql`SELECT 1`))));
        }),
      );
      expect(outer).toBeDefined();
      expect([errorText(outer), ...seen].join(' ')).toMatch(/idle[- ]in[- ]transaction/i);
    });
  });
});
