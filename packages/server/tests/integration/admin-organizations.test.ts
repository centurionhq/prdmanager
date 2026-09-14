/**
 * WO-101 — `POST /api/app/admin/organizations`: superadmin-only, creates the organization and invites
 * its owner by email, with no membership left for the superadmin itself.
 */
import { findMembership, findOrganizationBySlug, readPlatformAuditLog } from '@prdm/db';
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { bootstrapSuperadmin } from '../../src/cli/bootstrap-superadmin.js';
import { FakeMailer } from '../../src/mailer.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('POST /api/app/admin/organizations (WO-101)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  const PASSWORD = 'correct-horse-battery-staple';

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  test('a non-superadmin session is forbidden', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/admin/organizations',
      headers: { ...AUTH_HOST, cookie },
      payload: { name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.test' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('no session at all is unauthorized', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/admin/organizations',
      headers: AUTH_HOST,
      payload: { name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.test' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('a superadmin creates an org, invites its owner by email, and gets no membership in it', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const admin = await bootstrapSuperadmin({
      pool: pg.ownerPool,
      env,
      prompts: { email: async () => 'root@example.test', name: async () => 'Root', password: async () => PASSWORD },
      log: () => {},
    });
    const cookie = await signIn(app, admin.email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/admin/organizations',
      headers: { ...AUTH_HOST, cookie },
      payload: { name: 'Acme Inc', slug: 'acme-inc', ownerEmail: 'owner@example.test' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('acme-inc');
    expect(body.invitationId).toBeDefined();

    const org = await findOrganizationBySlug(pg.appPool, 'acme-inc');
    expect(org).not.toBeNull();
    expect(await findMembership(pg.appPool, org!.id, admin.userId)).toBeNull();

    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]!.to).toBe('owner@example.test');
    expect(mailer.messages[0]!.text).toContain('Acme Inc');

    const auditEntries = await readPlatformAuditLog(pg.ownerPool, admin.userId);
    expect(auditEntries.some((entry) => entry.action === 'platform.organization.created' && entry.target === org!.id)).toBe(true);

    await app.close();
  });

  test('creating an organization with an already-taken slug conflicts', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const admin = await bootstrapSuperadmin({
      pool: pg.ownerPool,
      env,
      prompts: { email: async () => 'root2@example.test', name: async () => 'Root', password: async () => PASSWORD },
      log: () => {},
    });
    const cookie = await signIn(app, admin.email);
    const payload = { name: 'Acme', slug: 'dup-slug', ownerEmail: 'owner@example.test' };

    const first = await app.inject({ method: 'POST', url: '/api/app/admin/organizations', headers: { ...AUTH_HOST, cookie }, payload });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: '/api/app/admin/organizations', headers: { ...AUTH_HOST, cookie }, payload });
    expect(second.statusCode).toBe(409);

    await app.close();
  });
});
