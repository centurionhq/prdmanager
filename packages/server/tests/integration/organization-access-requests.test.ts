/**
 * WO-732 (SDD-099 WO-D) — `/api/app/organizations/:orgSlug/access-requests*`: public request (invariant
 * response, own IP rate limit, behind CSRF), owner/admin list/approve/reject with audit log.
 */
import { createMemberFixture, createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { csrfHandshake, mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('/api/app/organizations/:orgSlug/access-requests (WO-732)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  const ORIGIN = env.publicUrl;
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

  function newApp(mailer = new FakeMailer()) {
    return { app: buildServer({ env, pool: pg.appPool, mailer, logger: false }), mailer };
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function seedOrgWithRole(app: ReturnType<typeof buildServer>, role: 'admin' | 'member') {
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role });
    return { user, org, cookie: await signIn(app, user.email) };
  }

  async function submitPublic(app: ReturnType<typeof buildServer>, slug: string, email = 'Visitor@Example.test') {
    return app.inject({
      method: 'POST',
      url: `/api/app/organizations/${slug}/access-requests`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN),
      payload: { email },
    });
  }

  async function pendingRequestId(orgId: string): Promise<string> {
    const { rows } = await pg.ownerPool.query('SELECT id FROM access_request WHERE org_id = $1 AND status = $2', [orgId, 'pending']);
    return rows[0].id as string;
  }

  test('an anonymous visitor with the CSRF handshake creates a pending request with a lower-cased email', async () => {
    const { app } = newApp();
    const org = await createOrganizationFixture(pg);

    const res = await submitPublic(app, org.slug);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const { rows } = await pg.ownerPool.query('SELECT email, status FROM access_request WHERE org_id = $1', [org.id]);
    expect(rows).toEqual([{ email: 'visitor@example.test', status: 'pending' }]);
    await app.close();
  });

  test('an unknown organization slug gets the identical response and leaves no row', async () => {
    const { app } = newApp();
    const org = await createOrganizationFixture(pg);

    const real = await submitPublic(app, org.slug);
    const ghost = await submitPublic(app, 'no-such-org');
    expect(ghost.statusCode).toBe(real.statusCode);
    expect(ghost.json()).toEqual(real.json());

    const { rows } = await pg.ownerPool.query('SELECT count(*)::int AS n FROM access_request');
    expect(rows[0].n).toBe(1);
    await app.close();
  });

  test('the public POST without the CSRF cookie/token is rejected with 403', async () => {
    const { app } = newApp();
    const org = await createOrganizationFixture(pg);
    // Handshake alone proves the anonymous token endpoint works; the POST below omits it.
    await csrfHandshake(app, AUTH_HOST, ORIGIN);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/access-requests`,
      headers: { ...AUTH_HOST, origin: ORIGIN },
      payload: { email: 'visitor@example.test' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('the 6th public POST from the same IP in the window gets 429 with retry-after', async () => {
    const { app } = newApp();
    const org = await createOrganizationFixture(pg);

    for (let i = 0; i < 5; i += 1) {
      expect((await submitPublic(app, org.slug, `v${i}@example.test`)).statusCode).toBe(200);
    }
    const sixth = await submitPublic(app, org.slug, 'v6@example.test');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers['retry-after']).toBeDefined();
    await app.close();
  });

  test('a member cannot list, approve or reject', async () => {
    const { app } = newApp();
    const { org, cookie } = await seedOrgWithRole(app, 'member');
    const base = `/api/app/organizations/${org.slug}/access-requests`;
    const id = '00000000-0000-0000-0000-000000000000';

    const list = await app.inject({ method: 'GET', url: base, headers: { ...AUTH_HOST, cookie } });
    expect(list.statusCode).toBe(403);
    for (const action of ['approve', 'reject']) {
      const res = await app.inject({ method: 'POST', url: `${base}/${id}/${action}`, headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie) });
      expect(res.statusCode).toBe(403);
    }
    await app.close();
  });

  test('an admin lists pending requests', async () => {
    const { app } = newApp();
    const { org, cookie } = await seedOrgWithRole(app, 'admin');
    await submitPublic(app, org.slug);

    const list = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/access-requests`, headers: { ...AUTH_HOST, cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().requests).toEqual([
      expect.objectContaining({ email: 'visitor@example.test', status: 'pending', resolvedAt: null, resolvedBy: null, createdAt: expect.any(String) }),
    ]);
    await app.close();
  });

  test('approving creates the invitation + email, marks approved and audits; a second approve does not duplicate', async () => {
    const { app, mailer } = newApp();
    const { user, org, cookie } = await seedOrgWithRole(app, 'admin');
    await submitPublic(app, org.slug);
    const requestId = await pendingRequestId(org.id);
    const url = `/api/app/organizations/${org.slug}/access-requests/${requestId}/approve`;

    const res = await app.inject({ method: 'POST', url, headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ requestId, status: 'approved', invitationId: expect.any(String), alreadyMember: false });
    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]!.text).toContain('#s=');

    const inv = await pg.ownerPool.query('SELECT email, role, status FROM invitation WHERE "organizationId" = $1', [org.id]);
    expect(inv.rows).toEqual([{ email: 'visitor@example.test', role: 'member', status: 'pending' }]);
    const reqRow = await pg.ownerPool.query('SELECT status, resolved_by FROM access_request WHERE id = $1', [requestId]);
    expect(reqRow.rows).toEqual([{ status: 'approved', resolved_by: user.id }]);
    const audit = await pg.ownerPool.query('SELECT target FROM audit_log WHERE org_id = $1 AND action = $2', [org.id, 'organization.access_request.approved']);
    expect(audit.rows).toEqual([{ target: requestId }]);

    const again = await app.inject({ method: 'POST', url, headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie) });
    expect(again.statusCode).toBe(404);
    expect(mailer.messages).toHaveLength(1);
    await app.close();
  });

  test('approving an email that is already a member creates no invitation', async () => {
    const { app, mailer } = newApp();
    const { org, cookie } = await seedOrgWithRole(app, 'admin');
    const existing = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: existing.id, role: 'member' });
    await submitPublic(app, org.slug, existing.email);
    const requestId = await pendingRequestId(org.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/access-requests/${requestId}/approve`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'approved', alreadyMember: true, invitationId: null });
    const inv = await pg.ownerPool.query('SELECT count(*)::int AS n FROM invitation WHERE "organizationId" = $1', [org.id]);
    expect(inv.rows[0].n).toBe(0);
    expect(mailer.messages).toHaveLength(0);
    await app.close();
  });

  test('rejecting marks rejected, creates no invitation or email, and audits the reason', async () => {
    const { app, mailer } = newApp();
    const { org, cookie } = await seedOrgWithRole(app, 'admin');
    await submitPublic(app, org.slug);
    const requestId = await pendingRequestId(org.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/access-requests/${requestId}/reject`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { reason: 'not a customer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ requestId, status: 'rejected' });

    const reqRow = await pg.ownerPool.query('SELECT status FROM access_request WHERE id = $1', [requestId]);
    expect(reqRow.rows[0].status).toBe('rejected');
    const inv = await pg.ownerPool.query('SELECT count(*)::int AS n FROM invitation WHERE "organizationId" = $1', [org.id]);
    expect(inv.rows[0].n).toBe(0);
    expect(mailer.messages).toHaveLength(0);
    const audit = await pg.ownerPool.query('SELECT metadata FROM audit_log WHERE org_id = $1 AND action = $2', [org.id, 'organization.access_request.rejected']);
    expect(audit.rows[0].metadata).toEqual({ reason: 'not a customer' });
    await app.close();
  });

  test('reject with an invalid reason is a 400', async () => {
    const { app } = newApp();
    const { org, cookie } = await seedOrgWithRole(app, 'admin');
    await submitPublic(app, org.slug);
    const requestId = await pendingRequestId(org.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/access-requests/${requestId}/reject`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { reason: 'x'.repeat(501) },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
