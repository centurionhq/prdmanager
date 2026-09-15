/**
 * `buildPgOidcJtiStore` (SDD-010 "Modo baseline de code-reports", WO-179): single-use `jti` replay
 * guard, backed by a real unique-index race under concurrent claims.
 */
import { buildPgOidcJtiStore } from '@prdm/db';
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

describe('buildPgOidcJtiStore (WO-179)', () => {
  test('claims a fresh jti once, and rejects the same jti again', async () => {
    const store = buildPgOidcJtiStore(pg.appPool);
    const expiresAt = new Date(Date.now() + 300_000);

    expect(await store.claim('jti-1', expiresAt)).toBe(true);
    expect(await store.claim('jti-1', expiresAt)).toBe(false);
    expect(await store.claim('jti-2', expiresAt)).toBe(true);
  });

  test('exactly one of many concurrent claims of the same jti wins, under real concurrency', async () => {
    const store = buildPgOidcJtiStore(pg.appPool);
    const expiresAt = new Date(Date.now() + 300_000);

    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim('jti-race', expiresAt)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => !r)).toHaveLength(9);
  });
});
