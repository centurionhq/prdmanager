/**
 * WO-094 — hardened session: fixed baseURL, Host allowlist, hashed verification identifiers,
 * cookieCache disabled, __Host- cookies in production, and session revocation on password
 * reset/change (SDD-006 §Autenticación). Runs against the real test Postgres instance (5433).
 */
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import { connect, schema } from '@prdm/db';
import { openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const AUTH_SCHEMA = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
  organization: schema.organization,
  member: schema.member,
  invitation: schema.invitation,
  twoFactor: schema.twoFactor,
};

function buildSeedAuth(env: ReturnType<typeof buildTestServerEnv>, pool: PgTestDb['appPool']) {
  const database = drizzleAdapter(connect(pool), { provider: 'pg', schema: AUTH_SCHEMA });
  return betterAuth({
    database,
    baseURL: env.publicUrl,
    secret: env.betterAuthSecret,
    emailAndPassword: { enabled: true, disableSignUp: false, minPasswordLength: 12 },
    plugins: [organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true })],
    logger: { disabled: true },
  });
}

function firstCookieHeader(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('expected a Set-Cookie header');
  return raw.split(';')[0]!;
}

describe('hardened session behavior (WO-094)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterAll(async () => {
    await pg.close();
  });

  async function seedUser(password = 'correct-horse-battery-staple'): Promise<{ email: string }> {
    const seedAuth = buildSeedAuth(env, pg.appPool);
    const email = `${randomUUID()}@example.test`;
    await seedAuth.api.signUpEmail({ body: { name: 'Test User', email, password } });
    return { email };
  }

  describe('Host guard', () => {
    test('rejects a poisoned Host header (trustProxy off)', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });

      const res = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: { host: 'evil.example' } });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
      await app.close();
    });

    test('ignores a poisoned X-Forwarded-Host when trustProxy is off, trusting only the raw Host', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/get-session',
        headers: { ...AUTH_HOST, 'x-forwarded-host': 'evil.example' },
      });

      expect(res.statusCode).not.toBe(404);
      await app.close();
    });

    test('rejects a poisoned X-Forwarded-Host when trustProxy is on, even with a legitimate raw Host', async () => {
      const trustProxyEnv = buildTestServerEnv({ trustProxy: true });
      const app = buildServer({ env: trustProxyEnv, pool: pg.appPool, mailer: new FakeMailer(), logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/get-session',
        headers: { host: new URL(trustProxyEnv.publicUrl).host, 'x-forwarded-host': 'evil.example' },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    test('accepts a matching X-Forwarded-Host when trustProxy is on', async () => {
      const trustProxyEnv = buildTestServerEnv({ trustProxy: true });
      const app = buildServer({ env: trustProxyEnv, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const expectedHost = new URL(trustProxyEnv.publicUrl).host;

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/get-session',
        headers: { host: '127.0.0.1:9999', 'x-forwarded-host': expectedHost },
      });

      expect(res.statusCode).not.toBe(404);
      await app.close();
    });
  });

  test('a reset-password request always emails a link rooted at PRDM_PUBLIC_URL', async () => {
    const { email } = await seedUser();
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      payload: { email },
      headers: AUTH_HOST,
    });

    expect(res.statusCode).toBe(200);
    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]!.text).toContain(env.publicUrl);
    await app.close();
  });

  test('verification identifiers are stored hashed, never as plaintext reset tokens', async () => {
    const { email } = await seedUser();
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email }, headers: AUTH_HOST });
    const resetUrl = mailer.messages[0]!.text.match(/https?:\/\/\S+/)![0]!;
    const token = resetUrl.split('/reset-password/')[1]!.split('?')[0]!;

    const { rows } = await pg.ownerPool.query<{ identifier: string }>('SELECT identifier FROM "verification" ORDER BY "createdAt" DESC LIMIT 1');
    expect(rows[0]!.identifier).not.toContain(token);

    await app.close();
  });

  test('resetting the password revokes the existing session', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const signIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    const cookie = firstCookieHeader(signIn.headers['set-cookie']);

    await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email }, headers: AUTH_HOST });
    const resetUrl = mailer.messages[0]!.text.match(/https?:\/\/\S+/)![0]!;
    const token = resetUrl.split('/reset-password/')[1]!.split('?')[0]!;

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { newPassword: 'a-new-correct-horse', token },
      headers: AUTH_HOST,
    });
    expect(reset.statusCode).toBe(200);

    const listSessions = await app.inject({
      method: 'GET',
      url: '/api/auth/list-sessions',
      headers: { ...AUTH_HOST, cookie },
    });
    expect(listSessions.statusCode).toBe(401);

    await app.close();
  });

  test('changing the password revokes other sessions and re-authenticates the caller with a fresh one', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const firstSignIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    const secondSignIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    const firstCookie = firstCookieHeader(firstSignIn.headers['set-cookie']);
    const secondCookie = firstCookieHeader(secondSignIn.headers['set-cookie']);

    const changePassword = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: password, newPassword: 'another-new-password' },
      headers: { ...AUTH_HOST, cookie: firstCookie },
    });
    expect(changePassword.statusCode).toBe(200);
    const freshCookie = firstCookieHeader(changePassword.headers['set-cookie']);

    const secondStillValid = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: { ...AUTH_HOST, cookie: secondCookie } });
    expect(secondStillValid.json()).toBeNull();

    const freshStillValid = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: { ...AUTH_HOST, cookie: freshCookie } });
    expect(freshStillValid.json()).not.toBeNull();

    await app.close();
  });

  test('cookieCache is disabled: sign-in never sets a session_data cache cookie', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);

    expect(cookies.some((c) => c!.includes('session_token'))).toBe(true);
    expect(cookies.some((c) => c!.includes('session_data'))).toBe(false);

    await app.close();
  });

  test('production uses __Host- prefixed, Secure, httpOnly, SameSite=Lax cookies', async () => {
    const password = 'correct-horse-battery-staple';
    const prodEnv = buildTestServerEnv({ nodeEnv: 'production', publicUrl: 'https://app.example.test' });
    const { email } = await seedUser(password);
    const mailer = new FakeMailer();
    const app = buildServer({ env: prodEnv, pool: pg.appPool, mailer, logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
      headers: { host: new URL(prodEnv.publicUrl).host },
    });
    const setCookie = firstFullCookie(res.headers['set-cookie']);

    expect(setCookie).toMatch(/^__Host-prdm\.session_token=/);
    expect(setCookie.toLowerCase()).toContain('secure');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie.toLowerCase()).not.toContain('domain=');

    await app.close();
  });
});

function firstFullCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('expected a Set-Cookie header');
  return raw;
}
