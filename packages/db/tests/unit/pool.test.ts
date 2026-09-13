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

describe('connect', () => {
  test('wraps the pool with a Drizzle query builder', () => {
    pool = createPool({ connectionString: 'postgres://prdm_app:x@127.0.0.1:5432/prdm' });
    const db = connect(pool);
    expect(db).toBeDefined();
    expect(typeof db.execute).toBe('function');
  });
});
