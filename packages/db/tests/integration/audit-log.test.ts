import { createTenantDb, readPlatformAuditLog, recordPlatformAuditLog } from '@prdm/db';
import { createOrganizationFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
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

describe('audit_log (WO-103)', () => {
  test('record + list round-trips within one org', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const entry = await db.auditLog.record({
      actorType: 'user',
      actorId: user.id,
      action: 'project.create',
      target: 'roadmap',
      metadata: { slug: 'roadmap' },
    });
    expect(entry.orgId).toBe(org.id);

    expect(await db.auditLog.list()).toEqual([entry]);
  });

  test("another org's audit_log rows are invisible", async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    await createTenantDb(pg.appPool)
      .forOrg(orgA.id)
      .auditLog.record({ actorType: 'user', actorId: user.id, action: 'org.rename', target: orgA.id });

    await expect(createTenantDb(pg.appPool).forOrg(orgB.id).auditLog.list()).resolves.toEqual([]);
  });

  test('recording metadata that looks like a secret throws before touching the database', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    await expect(
      db.auditLog.record({ actorType: 'user', actorId: user.id, action: 'x', target: 'y', metadata: { authorization: 'Bearer x' } }),
    ).rejects.toThrow(/looks like a secret/);
    expect(await db.auditLog.list()).toEqual([]);
  });

  test('prdm_app cannot UPDATE, DELETE or TRUNCATE audit_log (append-only)', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    await createTenantDb(pg.appPool)
      .forOrg(org.id)
      .auditLog.record({ actorType: 'user', actorId: user.id, action: 'x', target: 'y' });

    // Table-level privilege (GRANT/REVOKE) is checked before RLS, so this rejects regardless of
    // whether app.org_id is set on the connection that happens to serve each pooled query below.
    await expect(pg.appPool.query(`UPDATE audit_log SET action = 'changed'`)).rejects.toThrow(/permission denied/i);
    await expect(pg.appPool.query(`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/i);
    await expect(pg.appPool.query(`TRUNCATE audit_log`)).rejects.toThrow(/permission denied/i);
  });
});

describe('platform_audit_log (WO-103)', () => {
  test('prdm_app can insert but not directly SELECT', async () => {
    await recordPlatformAuditLog(pg.appPool, { actorType: 'system', action: 'bootstrap.superadmin_created' });
    await expect(pg.appPool.query('SELECT * FROM platform_audit_log')).rejects.toThrow(/permission denied/i);
  });

  test('prdm_app cannot UPDATE, DELETE or TRUNCATE platform_audit_log', async () => {
    await recordPlatformAuditLog(pg.appPool, { actorType: 'system', action: 'x' });
    await expect(pg.appPool.query(`UPDATE platform_audit_log SET action = 'changed'`)).rejects.toThrow(/permission denied/i);
    await expect(pg.appPool.query(`DELETE FROM platform_audit_log`)).rejects.toThrow(/permission denied/i);
    await expect(pg.appPool.query(`TRUNCATE platform_audit_log`)).rejects.toThrow(/permission denied/i);
  });

  test('read_platform_audit_log rejects a caller who is not a platform admin', async () => {
    const notAdmin = await createUserFixture(pg);
    await recordPlatformAuditLog(pg.appPool, { actorType: 'system', action: 'x' });

    await expect(readPlatformAuditLog(pg.appPool, notAdmin.id)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/not a platform admin/i) },
    });
  });

  test('read_platform_audit_log returns rows for a platform admin', async () => {
    const admin = await createUserFixture(pg);
    await pg.ownerPool.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [admin.id]);
    const written = await recordPlatformAuditLog(pg.appPool, { actorType: 'system', action: 'bootstrap.superadmin_created' });

    const rows = await readPlatformAuditLog(pg.appPool, admin.id);
    expect(rows).toEqual([written]);
  });

  test('recording metadata that looks like a secret throws before touching the database', async () => {
    await expect(recordPlatformAuditLog(pg.appPool, { actorType: 'system', action: 'x', metadata: { password: 'hunter2' } })).rejects.toThrow(
      /looks like a secret/,
    );
  });
});

describe('platform_admins (WO-103)', () => {
  test('prdm_app has SELECT but not INSERT/UPDATE/DELETE', async () => {
    const admin = await createUserFixture(pg);
    await pg.ownerPool.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [admin.id]);

    await expect(pg.appPool.query('SELECT user_id FROM platform_admins')).resolves.toMatchObject({ rows: [{ user_id: admin.id }] });
    await expect(pg.appPool.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [(await createUserFixture(pg)).id])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(pg.appPool.query('UPDATE platform_admins SET user_id = user_id')).rejects.toThrow(/permission denied/i);
    await expect(pg.appPool.query('DELETE FROM platform_admins')).rejects.toThrow(/permission denied/i);
  });
});
