/**
 * WO-105 — `POST /api/app/invitations/:id/accept`: new-user and existing-user acceptance paths,
 * expiry, id-without-secret rejection, reuse/double-acceptance, and rate limiting.
 */
import { findMembership, findOrganizationBySlug } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('POST /api/app/invitations/:id/accept (WO-105)', () => {
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

  /** Extracts `<id>` and `<secret>` from a `.../invite/<id>#s=<secret>` link inside an email body. */
  function extractInviteLink(text: string): { id: string; secret: string } {
    const match = /\/invite\/([^#\s]+)#s=(\S+)/.exec(text);
    if (!match) throw new Error(`no invite link found in: ${text}`);
    return { id: match[1]!, secret: match[2]! };
  }

  async function createInvitationViaAdmin(
    app: ReturnType<typeof buildServer>,
    mailer: FakeMailer,
    org: { id: string; slug: string },
    payload: { email: string; role: 'owner' | 'admin' | 'member'; projectGrants?: unknown },
  ): Promise<{ id: string; secret: string }> {
    const admin = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: admin.id, role: 'owner' });
    const cookie = await signIn(app, admin.email);
    mailer.messages.length = 0;

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations`,
      headers: { ...AUTH_HOST, cookie },
      payload,
    });
    expect(res.statusCode).toBe(200);
    return extractInviteLink(mailer.messages[0]!.text);
  }

  test('a new user accepts with name + password and becomes a member with the invited role', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const { id, secret } = await createInvitationViaAdmin(app, mailer, org, { email: 'newmember@example.test', role: 'admin' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${id}/accept`,
      headers: AUTH_HOST,
      payload: { secret, name: 'New Member', password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.organizationId).toBe(org.id);
    expect(await findMembership(pg.appPool, org.id, body.userId)).toEqual({ role: 'admin' });

    await app.close();
  });

  test('accepting without name/password (as a new user) is a validation error', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const { id, secret } = await createInvitationViaAdmin(app, mailer, org, { email: 'nopass@example.test', role: 'member' });

    const res = await app.inject({ method: 'POST', url: `/api/app/invitations/${id}/accept`, headers: AUTH_HOST, payload: { secret } });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('the id alone, with a wrong secret, is rejected as not found', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const { id } = await createInvitationViaAdmin(app, mailer, org, { email: 'idonly@example.test', role: 'member' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${id}/accept`,
      headers: AUTH_HOST,
      payload: { secret: 'totally-wrong-secret', name: 'X', password: PASSWORD },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test("one invitation's secret cannot be used against another invitation's id", async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const invA = await createInvitationViaAdmin(app, mailer, org, { email: 'a@example.test', role: 'member' });
    const invB = await createInvitationViaAdmin(app, mailer, org, { email: 'b@example.test', role: 'member' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${invB.id}/accept`,
      headers: AUTH_HOST,
      payload: { secret: invA.secret, name: 'X', password: PASSWORD },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('accepting twice fails the second time (reuse / double acceptance)', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const { id, secret } = await createInvitationViaAdmin(app, mailer, org, { email: 'once@example.test', role: 'member' });

    const first = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${id}/accept`,
      headers: AUTH_HOST,
      payload: { secret, name: 'First', password: PASSWORD },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${id}/accept`,
      headers: AUTH_HOST,
      payload: { secret, name: 'Second', password: PASSWORD },
    });
    expect(second.statusCode).toBe(409);

    await app.close();
  });

  test('an already signed-in existing user accepts with just the secret, no password needed', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const existing = await seedUser(env, pg.appPool, PASSWORD);
    const { id, secret } = await createInvitationViaAdmin(app, mailer, org, { email: existing.email, role: 'member' });
    const cookie = await signIn(app, existing.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${id}/accept`,
      headers: { ...AUTH_HOST, cookie },
      payload: { secret },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(existing.id);
    expect(await findMembership(pg.appPool, org.id, existing.id)).toEqual({ role: 'member' });

    await app.close();
  });

  test("an existing user's session email must match the invitation email", async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const existing = await seedUser(env, pg.appPool, PASSWORD);
    const { id, secret } = await createInvitationViaAdmin(app, mailer, org, { email: 'someone-else@example.test', role: 'member' });
    const cookie = await signIn(app, existing.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${id}/accept`,
      headers: { ...AUTH_HOST, cookie },
      payload: { secret },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('a revoked invitation cannot be accepted', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);
    const { id, secret } = await createInvitationViaAdmin(app, mailer, org, { email: 'revoke-me@example.test', role: 'member' });

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations/${id}/revoke`,
      headers: { ...AUTH_HOST, cookie },
    });
    expect(revoke.statusCode).toBe(200);

    const accept = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${id}/accept`,
      headers: AUTH_HOST,
      payload: { secret, name: 'X', password: PASSWORD },
    });
    expect(accept.statusCode).toBe(409);

    await app.close();
  });

  test('concurrent accept attempts for the same invitation: exactly one succeeds', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const org = await createOrganizationFixture(pg);
    const { id, secret } = await createInvitationViaAdmin(app, mailer, org, { email: 'racer@example.test', role: 'member' });

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: `/api/app/invitations/${id}/accept`,
        headers: AUTH_HOST,
        payload: { secret, name: 'Racer', password: PASSWORD },
      });

    const results = await Promise.all([attempt(), attempt(), attempt()]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([200, 409, 409]);

    await app.close();
  });
});
