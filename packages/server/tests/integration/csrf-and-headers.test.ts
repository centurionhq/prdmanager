/**
 * WO-108 — CSRF (double-submit via `@fastify/csrf-protection`) and security headers, exercised over real
 * HTTP against the built server: missing/invalid token, cross-site Origin, same-origin success, and the
 * response headers every route (including a plain 404) carries.
 */
import { createMemberFixture, createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { csrfHandshake, mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('CSRF + security headers on /api/app/* (WO-108)', () => {
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

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  test('GET /api/app/csrf-token issues a cookie and a token, and does not itself require CSRF', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/app/csrf-token', headers: { ...AUTH_HOST, origin: ORIGIN } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeDefined();
    await app.close();
  });

  test('a mutating /api/app/* request with no CSRF cookie/token at all is rejected with a 403 envelope', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });
    const cookie = await signIn(app, user.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: { ...AUTH_HOST, origin: ORIGIN, cookie },
      payload: { slug: 'roadmap', name: 'Roadmap' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'forbidden', message: 'invalid csrf token' } });
    await app.close();
  });

  test('a mutating request with the CSRF cookie but a wrong token header is rejected with a 403 envelope', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });
    const cookie = await signIn(app, user.email);
    const csrf = await csrfHandshake(app, AUTH_HOST, ORIGIN);

    // The real CSRF cookie from the handshake, but a wrong token header.
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: { ...AUTH_HOST, origin: ORIGIN, cookie: `${cookie}; ${csrf.headers.cookie}`, 'x-csrf-token': 'totally-wrong-token' },
      payload: { slug: 'roadmap', name: 'Roadmap' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'forbidden', message: 'invalid csrf token' } });
    await app.close();
  });

  test('a cross-site Origin is rejected with 403 even with a valid CSRF token', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });
    const cookie = await signIn(app, user.email);
    const csrf = await csrfHandshake(app, AUTH_HOST, ORIGIN);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: {
        ...AUTH_HOST,
        cookie: `${cookie}; ${csrf.headers.cookie}`,
        'x-csrf-token': csrf.headers['x-csrf-token'],
        origin: 'https://evil.test',
      },
      payload: { slug: 'roadmap', name: 'Roadmap' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'forbidden', message: 'cross-site request blocked' } });
    await app.close();
  });

  test('Sec-Fetch-Site: cross-site is rejected even with a matching, trusted Origin', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });
    const cookie = await signIn(app, user.email);
    const csrf = await csrfHandshake(app, AUTH_HOST, ORIGIN);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: {
        ...AUTH_HOST,
        cookie: `${cookie}; ${csrf.headers.cookie}`,
        'x-csrf-token': csrf.headers['x-csrf-token'],
        origin: ORIGIN,
        'sec-fetch-site': 'cross-site',
      },
      payload: { slug: 'roadmap', name: 'Roadmap' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('same-origin request with a valid CSRF token and session succeeds', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });
    const cookie = await signIn(app, user.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { slug: 'roadmap', name: 'Roadmap' },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  test('a same-origin request with Sec-Fetch-Site: same-origin and no Origin header at all still succeeds', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });
    const cookie = await signIn(app, user.email);
    const csrf = await csrfHandshake(app, AUTH_HOST, ORIGIN);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: {
        ...AUTH_HOST,
        cookie: `${cookie}; ${csrf.headers.cookie}`,
        'x-csrf-token': csrf.headers['x-csrf-token'],
        'sec-fetch-site': 'same-origin',
      },
      payload: { slug: 'roadmap-2', name: 'Roadmap 2' },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  test('GET requests under /api/app/* never require a CSRF token', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({ method: 'GET', url: '/api/app/organizations', headers: { ...AUTH_HOST, cookie } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  test('security headers are present on every response, including a 404 and the health check', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });

    const notFound = await app.inject({ method: 'GET', url: '/api/app/does-not-exist', headers: AUTH_HOST });
    expect(notFound.statusCode).toBe(404);
    assertSecurityHeaders(notFound.headers);

    const health = await app.inject({ method: 'GET', url: '/api/health', headers: AUTH_HOST });
    assertSecurityHeaders(health.headers);

    await app.close();
  });

  test('CSP connect-src carries the exact public wss host, never a bare "wss:"', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: AUTH_HOST });
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain(`connect-src 'self' wss://${new URL(env.publicUrl).host}`);
    expect(csp).not.toMatch(/wss:(?!\/\/)/);
    await app.close();
  });

  test('HSTS is absent outside production, and present in production', async () => {
    const devApp = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const devRes = await devApp.inject({ method: 'GET', url: '/api/health', headers: AUTH_HOST });
    expect(devRes.headers['strict-transport-security']).toBeUndefined();
    await devApp.close();

    const prodEnv = buildTestServerEnv({ nodeEnv: 'production' });
    const prodApp = buildServer({ env: prodEnv, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const prodRes = await prodApp.inject({ method: 'GET', url: '/api/health', headers: { host: new URL(prodEnv.publicUrl).host } });
    expect(prodRes.headers['strict-transport-security']).toBeDefined();
    await prodApp.close();
  });
});

function assertSecurityHeaders(headers: Record<string, unknown>): void {
  expect(headers['content-security-policy']).toEqual(expect.any(String));
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
}
