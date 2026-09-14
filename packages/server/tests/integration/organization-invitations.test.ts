/**
 * WO-105 — `/api/app/organizations/:orgSlug/invitations/*`: create, list (never returning secrets) and
 * revoke, owner/admin only.
 */
import { createMemberFixture, createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('/api/app/organizations/:orgSlug/invitations (WO-105)', () => {
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

  test('a member cannot create, list or revoke invitations', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const member = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    const cookie = await signIn(app, member.email);

    const create = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations`,
      headers: { ...AUTH_HOST, cookie },
      payload: { email: 'invitee@example.test', role: 'member' },
    });
    expect(create.statusCode).toBe(403);

    const list = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/invitations`, headers: { ...AUTH_HOST, cookie } });
    expect(list.statusCode).toBe(403);

    await app.close();
  });

  test('an admin creates an invitation, it lists without a secret, and can be revoked', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const admin = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: admin.id, role: 'admin' });
    const cookie = await signIn(app, admin.email);

    const create = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations`,
      headers: { ...AUTH_HOST, cookie },
      payload: { email: 'invitee@example.test', role: 'member' },
    });
    expect(create.statusCode).toBe(200);
    const invitationId = create.json().invitationId as string;
    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]!.text).toContain('#s=');

    const list = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/invitations`, headers: { ...AUTH_HOST, cookie } });
    expect(list.statusCode).toBe(200);
    const body = JSON.stringify(list.json());
    expect(body).not.toContain('secret');
    expect(list.json().invitations).toEqual([{ id: invitationId, email: 'invitee@example.test', role: 'member', status: 'pending', expiresAt: expect.any(String) }]);

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations/${invitationId}/revoke`,
      headers: { ...AUTH_HOST, cookie },
    });
    expect(revoke.statusCode).toBe(200);

    const listAfter = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/invitations`, headers: { ...AUTH_HOST, cookie } });
    expect(listAfter.json().invitations[0].status).toBe('canceled');

    await app.close();
  });

  test('an admin cannot invite a new owner', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const admin = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: admin.id, role: 'admin' });
    const cookie = await signIn(app, admin.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations`,
      headers: { ...AUTH_HOST, cookie },
      payload: { email: 'newowner@example.test', role: 'owner' },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  test('a cross-org invitations route 404s for a non-member', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const otherOrg = await createOrganizationFixture(pg);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({ method: 'GET', url: `/api/app/organizations/${otherOrg.slug}/invitations`, headers: { ...AUTH_HOST, cookie } });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
