import { Pool } from 'pg';
import { afterEach, describe, expect, test } from 'vitest';
import { connect, createPool } from '../../src/pool.js';

let pool: Pool | undefined;
afterEach(async () => {
  await pool?.end();
  pool = undefined;
});

describe('createPool', () => {
  test('builds a pg Pool from a connection string without opening a socket', () => {
    pool = createPool({ connectionString: 'postgres://prdm_app:x@127.0.0.1:5432/prdm' });
    expect(pool).toBeInstanceOf(Pool);
    expect(pool.options.connectionString).toBe('postgres://prdm_app:x@127.0.0.1:5432/prdm');
    expect(pool.options.max).toBe(10);
  });

  test('honors a custom max pool size', () => {
    pool = createPool({ connectionString: 'postgres://prdm_app:x@127.0.0.1:5432/prdm', maxConnections: 3 });
    expect(pool.options.max).toBe(3);
  });
});

describe('createPool timeouts (WO-645 · SDD-073 D1)', () => {
  const url = 'postgres://prdm_app:x@127.0.0.1:5432/prdm';

  test('applies explicit defaults for connection, statement and idle-in-transaction timeouts', () => {
    pool = createPool({ connectionString: url });
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
    expect(pool.options.statement_timeout).toBe(30000);
    expect(pool.options.idle_in_transaction_session_timeout).toBe(60000);
    expect(pool.options.max).toBe(10);
  });

  test('lets PgConfig override all three timeouts and the pool size', () => {
    pool = createPool({
      connectionString: url,
      maxConnections: 4,
      connectionTimeoutMillis: 250,
      statementTimeoutMillis: 1500,
      idleInTransactionSessionTimeoutMillis: 2500,
    });
    expect(pool.options.max).toBe(4);
    expect(pool.options.connectionTimeoutMillis).toBe(250);
    expect(pool.options.statement_timeout).toBe(1500);
    expect(pool.options.idle_in_transaction_session_timeout).toBe(2500);
  });

  test('propagates 0 ("no cap") instead of falling back to the default', () => {
    pool = createPool({ connectionString: url, statementTimeoutMillis: 0 });
    expect(pool.options.statement_timeout).toBe(0);
  });

  test.each([
    ['connectionTimeoutMillis', { connectionTimeoutMillis: -1 }],
    ['statementTimeoutMillis', { statementTimeoutMillis: 1.5 }],
    ['idleInTransactionSessionTimeoutMillis', { idleInTransactionSessionTimeoutMillis: Number.NaN }],
  ])('throws RangeError naming %s when the value is invalid', (field, override) => {
    expect(() => createPool({ connectionString: url, ...override })).toThrow(RangeError);
    expect(() => createPool({ connectionString: url, ...override })).toThrow(new RegExp(field));
  });
});

describe('connect', () => {
  test('wraps the pool with a Drizzle query builder', () => {
    pool = createPool({ connectionString: 'postgres://prdm_app:x@127.0.0.1:5432/prdm' });
    const db = connect(pool);
    expect(db).toBeDefined();
    expect(typeof db.execute).toBe('function');
  });
});
