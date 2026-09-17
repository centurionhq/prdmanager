import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openTestDb } from '../../src/db.js';
import { openTestPg } from '../../src/pg.js';

/**
 * WO-407: `openTestDb`/`openTestPg` must refuse to open a real database connection when
 * `PRDM_TEST_NO_DB=1` — the flag the `unit-node`/`unit-jsdom` vitest projects set (see
 * `vitest.config.ts`) precisely so that a test which needs a real Neo4j/Postgres never runs there
 * by accident. This suite runs in `unit-node` itself (`PRDM_TEST_NO_DB` is already `'1'`), so it must
 * never attempt a real connection — both calls should throw before touching the network.
 */
describe('openTestDb / openTestPg guard against PRDM_TEST_NO_DB', () => {
  const ORIGINAL = process.env.PRDM_TEST_NO_DB;

  beforeEach(() => {
    process.env.PRDM_TEST_NO_DB = '1';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PRDM_TEST_NO_DB;
    else process.env.PRDM_TEST_NO_DB = ORIGINAL;
  });

  test('openTestDb throws a clear error instead of connecting to Neo4j', async () => {
    // @ts-expect-error -- the guard must throw before this bogus config is ever used.
    await expect(openTestDb({})).rejects.toThrow(/PRDM_TEST_NO_DB/);
  });

  test('openTestPg throws a clear error instead of connecting to Postgres', async () => {
    await expect(
      openTestPg({ migrationUrl: 'postgres://bogus/db', appUrl: 'postgres://bogus/db' }),
    ).rejects.toThrow(/PRDM_TEST_NO_DB/);
  });

  test('the error message says the test must move to an integration directory', async () => {
    // @ts-expect-error -- same bogus config as above.
    await expect(openTestDb({})).rejects.toThrow(/tests\/integration/);
  });
});
