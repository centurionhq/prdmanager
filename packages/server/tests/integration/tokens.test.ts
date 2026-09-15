/**
 * WO-109 — `/api/app/tokens` (personal), `GET /api/v1/me` and the Bearer plugin: issuance shows the
 * secret exactly once, listing never does, TTL is capped at 90 days, revoked/expired tokens are
 * rejected, a cookie riding along on a Bearer route is rejected, and failed Bearer attempts are
 * rate-limited.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('/api/app/tokens, /api/v1/me and the Bearer plugin (WO-109)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  const ORIGIN = env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';
  const DAY_MS = 24 * 60 * 60 * 1000;

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

  test('POST /api/app/tokens returns the secret once; GET never includes it', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { orgSlug: org.slug, name: 'laptop', scopes: ['governance:read'], expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString() },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(typeof body.secret).toBe('string');
    expect(body.token.prefix).toMatch(/^prdm_pat_/);
    expect(body.token).not.toHaveProperty('secret');
    expect(body.token).not.toHaveProperty('secretHash');

    const list = await app.inject({ method: 'GET', url: `/api/app/tokens?orgSlug=${org.slug}`, headers: { ...AUTH_HOST, cookie } });
    expect(list.statusCode).toBe(200);
    const { tokens } = list.json();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).not.toHaveProperty('secret');
    expect(JSON.stringify(tokens[0])).not.toContain(body.secret.split('.')[1]);

    await app.close();
  });

  test('POST /api/app/tokens rejects an expiresAt beyond 90 days', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { orgSlug: org.slug, name: 'laptop', scopes: ['governance:read'], expiresAt: new Date(Date.now() + 91 * DAY_MS).toISOString() },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('revoking another user\'s personal token 404s; revoking your own works', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const other = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: other.id, role: 'member' });
    const ownerCookie = await signIn(app, owner.email);
    const otherCookie = await signIn(app, other.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { orgSlug: org.slug, name: 'laptop', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const tokenId = created.json().token.id;

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/tokens/${tokenId}/revoke?orgSlug=${org.slug}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, otherCookie),
    });
    expect(forbidden.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/tokens/${tokenId}/revoke?orgSlug=${org.slug}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
    });
    expect(ok.statusCode).toBe(200);

    await app.close();
  });

  test('GET /api/v1/me with a valid Bearer token returns the org and user handle', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    await pg.ownerPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, $2)`, [owner.id, `handle-${owner.id.slice(0, 8)}`]);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { orgSlug: org.slug, name: 'ci', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret;

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.organization.id).toBe(org.id);
    expect(body.user.id).toBe(owner.id);

    await app.close();
  });

  test('GET /api/v1/me rejects a malformed Bearer token before any DB error surfaces', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: 'Bearer not-a-real-token' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('GET /api/v1/me rejects a request that also carries a cookie', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const sessionCookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, sessionCookie),
      payload: { orgSlug: org.slug, name: 'ci', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${secret}`, cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  test('a revoked token is rejected on GET /api/v1/me', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { orgSlug: org.slug, name: 'ci', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const { secret, token } = created.json();

    await app.inject({
      method: 'POST',
      url: `/api/app/tokens/${token.id}/revoke?orgSlug=${org.slug}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  test('an expired token is rejected on GET /api/v1/me (injected clock, no wall-clock sleep)', async () => {
    const past = new Date('2020-01-01T00:00:00Z');
    const future = new Date('2020-01-02T00:00:00Z');
    const clockRef = { now: past };
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, clock: () => clockRef.now });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { orgSlug: org.slug, name: 'ci', scopes: ['governance:read'], expiresAt: new Date(past.getTime() + DAY_MS).toISOString() },
    });
    const { secret } = created.json();

    clockRef.now = future;
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(401);

    await app.close();
  });

  test('a project non-member cannot get a personal token scoped to that project, even as its own creator (WO-257)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const member = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    const memberCookie = await signIn(app, member.email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, memberCookie),
      payload: { orgSlug: org.slug, name: 'sneaky', scopes: ['mcp:read'], projectIds: [project.id], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(res.statusCode).toBe(403);

    // The same request succeeds once the caller actually has a `project_members` row for it.
    await pg.ownerPool.query(`INSERT INTO project_members (project_id, org_id, user_id, role) VALUES ($1, $2, $3, 'developer')`, [project.id, org.id, member.id]);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, memberCookie),
      payload: { orgSlug: org.slug, name: 'legit', scopes: ['mcp:read'], projectIds: [project.id], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(ok.statusCode).toBe(200);

    await app.close();
  });

  test('an org owner/admin may scope a token to any project in the org without a project_members row (WO-257)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { orgSlug: org.slug, name: 'owner scoped', scopes: ['mcp:read'], projectIds: [project.id], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  test('an unscoped personal token with governance:read or reports:write requires an org admin (WO-257)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const org = await createOrganizationFixture(pg);
    const member = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    const memberCookie = await signIn(app, member.email);

    const deniedGovernance = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, memberCookie),
      payload: { orgSlug: org.slug, name: 'unscoped', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(deniedGovernance.statusCode).toBe(403);

    const deniedReportsWrite = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, memberCookie),
      payload: { orgSlug: org.slug, name: 'unscoped', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(deniedReportsWrite.statusCode).toBe(403);

    // A scope not on the sensitive list is unaffected — a plain member can still get an unscoped
    // mcp:read token (which only ever exposes projects they can already see, per its own contract).
    const allowedMcp = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, memberCookie),
      payload: { orgSlug: org.slug, name: 'unscoped mcp', scopes: ['mcp:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(allowedMcp.statusCode).toBe(200);

    // An org owner is exempt from the restriction entirely.
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const ownerCookie = await signIn(app, owner.email);
    const ownerAllowed = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { orgSlug: org.slug, name: 'owner unscoped', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(ownerAllowed.statusCode).toBe(200);

    await app.close();
  });

  test('failed Bearer attempts are rate-limited per IP', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    let lastStatus = 0;
    for (let i = 0; i < 25; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: 'Bearer not-a-real-token' } });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
    await app.close();
  });
});
