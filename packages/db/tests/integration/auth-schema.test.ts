import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { openTestPg, truncateAll, createOrganizationFixture, createUserFixture, type PgTestDb } from '@prdm/testkit';

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

async function insertUser(): Promise<{ id: string; email: string }> {
  const id = `user_${randomUUID()}`;
  const email = `${randomUUID()}@example.test`;
  await pg.appPool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`,
    [id, 'Test User', email],
  );
  return { id, email };
}

describe('better-auth tables (WO-092)', () => {
  test('prdm_app can insert and read across every better-auth table', async () => {
    const { id: userId } = await insertUser();

    await pg.appPool.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`, [
      `org_${randomUUID()}`,
      'Acme',
      `acme-${randomUUID()}`,
    ]);
    const org = await pg.appPool.query<{ id: string }>(`SELECT id FROM "organization" LIMIT 1`);
    const orgId = org.rows[0]!.id;

    await pg.appPool.query(`INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'owner', now())`, [
      randomUUID(),
      orgId,
      userId,
    ]);
    await pg.appPool.query(`INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ($1, now() + interval '1 day', $2, now(), now(), $3)`, [
      randomUUID(),
      randomUUID(),
      userId,
    ]);
    await pg.appPool.query(
      `INSERT INTO "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES ($1, $2, 'credential', $3, now(), now())`,
      [randomUUID(), userId, userId],
    );
    await pg.appPool.query(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ($1, 'x', 'y', now() + interval '1 hour', now(), now())`, [
      randomUUID(),
    ]);
    await pg.appPool.query(
      `INSERT INTO "invitation" (id, "organizationId", email, status, "expiresAt", "createdAt", "inviterId") VALUES ($1, $2, 'invitee@example.test', 'pending', now() + interval '1 day', now(), $3)`,
      [randomUUID(), orgId, userId],
    );
    await pg.appPool.query(
      `INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") VALUES ($1, 'secret', 'codes', $2)`,
      [randomUUID(), userId],
    );

    const { rows: members } = await pg.appPool.query(`SELECT role FROM "member" WHERE "userId" = $1`, [userId]);
    expect(members).toEqual([{ role: 'owner' }]);
  });

  test('prdm_app cannot create or drop tables (no CREATE on the schema)', async () => {
    await expect(pg.appPool.query('CREATE TABLE should_fail (id int)')).rejects.toThrow(/permission denied/i);
  });
});

describe('user_profile (WO-092)', () => {
  test('handle must satisfy the ACTOR_PATTERN handle charset', async () => {
    const { id: userId } = await insertUser();
    await expect(pg.appPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, 'bad handle!')`, [userId])).rejects.toThrow(
      /violates check constraint/i,
    );
  });

  test('a valid handle can be inserted and read back', async () => {
    const { id: userId } = await insertUser();
    await pg.appPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, 'dev.handle-1')`, [userId]);
    const { rows } = await pg.appPool.query<{ handle: string }>(`SELECT handle FROM "user_profile" WHERE user_id = $1`, [userId]);
    expect(rows).toEqual([{ handle: 'dev.handle-1' }]);
  });

  test('handle is immutable: UPDATE changing it is rejected', async () => {
    const { id: userId } = await insertUser();
    await pg.appPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, 'immutable-handle')`, [userId]);

    await expect(
      pg.appPool.query(`UPDATE "user_profile" SET handle = 'changed-handle' WHERE user_id = $1`, [userId]),
    ).rejects.toThrow(/immutable/i);
  });

  test('rewriting the same handle value back is allowed (no actual change)', async () => {
    const { id: userId } = await insertUser();
    await pg.appPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, 'stable-handle')`, [userId]);

    await expect(pg.appPool.query(`UPDATE "user_profile" SET handle = 'stable-handle' WHERE user_id = $1`, [userId])).resolves.toBeDefined();
  });

  test('a handle is never reused, even after the owning user_profile row is gone', async () => {
    const first = await insertUser();
    await pg.appPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, 'once-only-handle')`, [first.id]);

    // Cascades from deleting the user (only prdm_owner needs DELETE on "user"; prdm_app never deletes
    // users directly in the product, but exercising the cascade end-to-end needs some deletion path).
    await pg.ownerPool.query(`DELETE FROM "user" WHERE id = $1`, [first.id]);
    const { rows: profiles } = await pg.ownerPool.query(`SELECT 1 FROM "user_profile" WHERE handle = 'once-only-handle'`);
    expect(profiles).toEqual([]);

    const second = await insertUser();
    await expect(
      pg.appPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, 'once-only-handle')`, [second.id]),
    ).rejects.toThrow(/already been used/i);
  });

  test('prdm_app has no direct grant on retired_handles', async () => {
    await expect(pg.appPool.query(`SELECT * FROM "retired_handles"`)).rejects.toThrow(/permission denied/i);
  });
});

describe('testkit factories backed by real inserts (WO-092)', () => {
  test('createOrganizationFixture and createUserFixture insert real rows', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);

    const { rows: orgRows } = await pg.appPool.query(`SELECT slug FROM "organization" WHERE id = $1`, [org.id]);
    expect(orgRows).toEqual([{ slug: org.slug }]);

    const { rows: profileRows } = await pg.appPool.query(`SELECT handle FROM "user_profile" WHERE user_id = $1`, [user.id]);
    expect(profileRows).toEqual([{ handle: user.handle }]);
  });
});
