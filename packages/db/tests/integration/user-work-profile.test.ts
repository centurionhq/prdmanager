/**
 * WO-541 (SDD-051/PRD-033 R1) — `findUserWorkProfile`/`setUserWorkProfile`: the per-user work profile the
 * Planta's entry band remembers. Against a real Postgres, because what matters here lives in the database:
 * the CHECK on the three allowed values, the cascade from `user`, and the `prdm_app` grant, which is
 * deliberately narrower than the table owner's (no DELETE).
 */
import { randomUUID } from 'node:crypto';
import { findUserWorkProfile, setUserWorkProfile } from '@prdm/db';
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

/** A bare `user` row with no `user_profile`: the account of someone who never set a handle, which is
 * exactly the person the work profile exists for. */
async function createBareUser(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const id = `user_${suffix}`;
  await pg.ownerPool.query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`, [
    id,
    id,
    `${suffix}@example.test`,
  ]);
  return { id };
}

describe('user_work_profile (WO-541)', () => {
  test('findUserWorkProfile is null before anything is chosen', async () => {
    const user = await createBareUser();
    expect(await findUserWorkProfile(pg.appPool, user.id)).toBeNull();
  });

  test('works for someone who never set a handle: it does not depend on user_profile', async () => {
    const user = await createBareUser();
    await setUserWorkProfile(pg.appPool, user.id, 'negocio');

    const { rows } = await pg.ownerPool.query(`SELECT 1 FROM user_profile WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(0);
    expect(await findUserWorkProfile(pg.appPool, user.id)).toBe('negocio');
  });

  test('changing the profile is an update of the same row, not a second one', async () => {
    const user = await createBareUser();
    await setUserWorkProfile(pg.appPool, user.id, 'producto');
    await setUserWorkProfile(pg.appPool, user.id, 'developer');

    expect(await findUserWorkProfile(pg.appPool, user.id)).toBe('developer');
    const { rows } = await pg.ownerPool.query(`SELECT count(*)::int AS n FROM user_work_profile WHERE user_id = $1`, [user.id]);
    expect(rows[0].n).toBe(1);
  });

  test('choosing the same profile twice is idempotent', async () => {
    const user = await createBareUser();
    await setUserWorkProfile(pg.appPool, user.id, 'producto');
    await expect(setUserWorkProfile(pg.appPool, user.id, 'producto')).resolves.toBe('producto');
  });

  test('each person keeps their own profile', async () => {
    const a = await createBareUser();
    const b = await createBareUser();
    await setUserWorkProfile(pg.appPool, a.id, 'negocio');
    await setUserWorkProfile(pg.appPool, b.id, 'developer');

    expect(await findUserWorkProfile(pg.appPool, a.id)).toBe('negocio');
    expect(await findUserWorkProfile(pg.appPool, b.id)).toBe('developer');
  });

  test('the database itself rejects a value outside the three profiles, whatever the application sends', async () => {
    const user = await createBareUser();
    await expect(pg.ownerPool.query(`INSERT INTO user_work_profile (user_id, profile) VALUES ($1, 'gerente')`, [user.id])).rejects.toThrow(/user_work_profile_profile_check/);
  });

  test('the row leaves with its user: cascade, not a DELETE grant', async () => {
    const user = await createBareUser();
    await setUserWorkProfile(pg.appPool, user.id, 'producto');
    await pg.ownerPool.query(`DELETE FROM "user" WHERE id = $1`, [user.id]);

    const { rows } = await pg.ownerPool.query(`SELECT 1 FROM user_work_profile WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(0);
  });

  test('prdm_app cannot DELETE from it directly', async () => {
    const user = await createBareUser();
    await setUserWorkProfile(pg.appPool, user.id, 'producto');
    await expect(pg.appPool.query(`DELETE FROM user_work_profile WHERE user_id = $1`, [user.id])).rejects.toThrow(/permission denied/);
  });
});
