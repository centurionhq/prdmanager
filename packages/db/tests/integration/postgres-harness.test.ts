import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
  // A throwaway table this suite owns end-to-end: created + granted as prdm_owner, read/written as
  // prdm_app, proving both the connection and the WO-089 privilege wiring actually work end-to-end.
  await pg.ownerPool.query('CREATE TABLE IF NOT EXISTS test_harness_probe (id serial primary key, val text not null)');
  await pg.ownerPool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON test_harness_probe TO prdm_app');
  await pg.ownerPool.query('GRANT USAGE, SELECT ON SEQUENCE test_harness_probe_id_seq TO prdm_app');
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.ownerPool.query('DROP TABLE IF EXISTS test_harness_probe');
  await pg.close();
});

describe('Postgres integration harness (WO-090)', () => {
  test('connects as prdm_app and can read/write through the app pool', async () => {
    await pg.appPool.query('INSERT INTO test_harness_probe (val) VALUES ($1)', ['hello']);
    const { rows } = await pg.appPool.query<{ val: string }>('SELECT val FROM test_harness_probe');
    expect(rows).toEqual([{ val: 'hello' }]);
  });

  test('truncates between tests: the row inserted by the previous test is gone', async () => {
    const { rows } = await pg.appPool.query('SELECT * FROM test_harness_probe');
    expect(rows).toEqual([]);
  });

  test('prdm_app cannot bypass RLS and is not a member of prdm_owner (SDD-006 §Aislamiento)', async () => {
    const { rows } = await pg.ownerPool.query<{ rolbypassrls: boolean }>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'prdm_app'",
    );
    expect(rows[0]?.rolbypassrls).toBe(false);
    const { rows: membership } = await pg.ownerPool.query(
      `SELECT 1 FROM pg_auth_members m
         JOIN pg_roles member ON member.oid = m.member
         JOIN pg_roles grp ON grp.oid = m.roleid
        WHERE member.rolname = 'prdm_app' AND grp.rolname = 'prdm_owner'`,
    );
    expect(membership).toEqual([]);
  });
});
