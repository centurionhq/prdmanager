/**
 * WO-432 — `createUserProfile`/`findUserProfile`: create-once `user_profile.handle`, the "dev:<handle>"
 * actor identity `claim_work_order`/`complete_work_order`/`archive_work_order` require of a human
 * caller. The immutability and never-reuse guarantees are enforced in the database itself (triggers in
 * `packages/db/migrations/0000_better_auth_and_user_profile.sql`), so this exercises the real Postgres
 * instance rather than mocking it.
 */
import { randomUUID } from 'node:crypto';
import { HandleTakenError, createUserProfile, findUserProfile } from '@prdm/db';
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

/** `createUserFixture` (testkit) always inserts a `user_profile` row too, which defeats the point of
 * these tests (exercising the create-once gap `createUserProfile` fills, WO-432) -- this inserts only
 * the bare `user` row, matching a real freshly-signed-up account that has never set a handle. */
async function createBareUser(): Promise<{ id: string; email: string }> {
  const suffix = randomUUID();
  const user = { id: `user_${suffix}`, email: `${suffix}@example.test` };
  await pg.ownerPool.query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`, [
    user.id,
    user.email,
    user.email,
  ]);
  return user;
}

describe('user_profile (WO-432)', () => {
  test('findUserProfile returns null before a handle is set', async () => {
    const user = await createBareUser();

    expect(await findUserProfile(pg.appPool, user.id)).toBeNull();
  });

  test('createUserProfile sets the handle, then findUserProfile reports it', async () => {
    const user = await createBareUser();

    const created = await createUserProfile(pg.appPool, { userId: user.id, handle: 'tano' });
    expect(created).toEqual({ userId: user.id, handle: 'tano' });

    expect(await findUserProfile(pg.appPool, user.id)).toEqual({ userId: user.id, handle: 'tano' });
  });

  test('createUserProfile rejects a handle already taken by another user with HandleTakenError', async () => {
    const first = await createBareUser();
    const second = await createBareUser();

    await createUserProfile(pg.appPool, { userId: first.id, handle: 'shared' });

    await expect(createUserProfile(pg.appPool, { userId: second.id, handle: 'shared' })).rejects.toThrow(HandleTakenError);
  });

  test('the handle is immutable: a second insert for the same user (a different handle) is rejected', async () => {
    const user = await createBareUser();
    await createUserProfile(pg.appPool, { userId: user.id, handle: 'first' });

    await expect(createUserProfile(pg.appPool, { userId: user.id, handle: 'second' })).rejects.toThrow();
    expect(await findUserProfile(pg.appPool, user.id)).toEqual({ userId: user.id, handle: 'first' });
  });
});
