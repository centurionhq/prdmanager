/**
 * WO-101 — `platform_admins` reads/inserts (SDD-006 §Modelo de datos): `prdm_app` only ever gets
 * `SELECT` (asserted by the WO-099 catalog test); `insertPlatformAdmin` is `prdm_owner`-only and used
 * here through `pg.ownerPool` accordingly.
 */
import { countPlatformAdmins, insertPlatformAdmin, isPlatformAdmin, readPlatformAuditLog, reconcileSuperadminMemberships } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
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

describe('platform_admins (WO-101)', () => {
  test('isPlatformAdmin is false until a row exists, then true; countPlatformAdmins tracks it', async () => {
    const user = await createUserFixture(pg);
    expect(await isPlatformAdmin(pg.appPool, user.id)).toBe(false);
    expect(await countPlatformAdmins(pg.appPool)).toBe(0);

    await insertPlatformAdmin(pg.ownerPool, user.id);

    expect(await isPlatformAdmin(pg.appPool, user.id)).toBe(true);
    expect(await countPlatformAdmins(pg.appPool)).toBe(1);
  });

  test('prdm_app cannot insert into platform_admins directly (SELECT-only grant)', async () => {
    const user = await createUserFixture(pg);
    let caught: unknown;
    try {
      await insertPlatformAdmin(pg.appPool, user.id);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = caught instanceof Error && caught.cause instanceof Error ? caught.cause.message : (caught as Error).message;
    expect(cause).toMatch(/permission denied/i);
  });
});

describe('reconcileSuperadminMemberships (security review #1, WO-101)', () => {
  test('removes a stray member row left by a crashed admin-org-creation flow and audits it', async () => {
    const admin = await createUserFixture(pg);
    await insertPlatformAdmin(pg.ownerPool, admin.id);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: admin.id, role: 'owner' });

    const removed = await reconcileSuperadminMemberships(pg.appPool);
    expect(removed).toBe(1);

    const { rows } = await pg.ownerPool.query(`SELECT 1 FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [org.id, admin.id]);
    expect(rows).toHaveLength(0);

    const auditRows = await readPlatformAuditLog(pg.appPool, admin.id);
    expect(auditRows.some((row) => row.action === 'platform.superadmin_membership.reconciled' && row.target === org.id)).toBe(true);
  });

  test('is a no-op when no superadmin holds a membership', async () => {
    const user = await createUserFixture(pg);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'member' });

    expect(await reconcileSuperadminMemberships(pg.appPool)).toBe(0);
    const { rows } = await pg.ownerPool.query(`SELECT 1 FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [org.id, user.id]);
    expect(rows).toHaveLength(1);
  });
});
