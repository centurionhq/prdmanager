/**
 * WO-093 — better-auth mounted in Fastify behind an explicit allowlist (SDD-006 §Autenticación).
 * Runs against the real test Postgres instance (5433) since better-auth's `auth.handler` performs
 * real drizzle queries even for endpoints that ultimately reject the request.
 */
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { connect, schema } from '@prdm/db';
import { openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { AUTH_ALLOWED_PATHS, ORGANIZATION_MUTATION_PATHS } from '../../src/auth/allowlist.js';
import { buildAuth } from '../../src/auth/build-auth.js';
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

/** Stands in for a superadmin bootstrap script's own user-creation path (see the WO-083 learning
 * test): `disableSignUp` has no "system action" bypass, so seeding a fixture user for HTTP-level
 * assertions needs a second instance, over the exact same tables, with sign-up left enabled. */
function buildSeedAuth(env: ReturnType<typeof buildTestServerEnv>, pool: PgTestDb['appPool']) {
  const database = drizzleAdapter(connect(pool), { provider: 'pg', schema: AUTH_SCHEMA });
  return betterAuth({
    database,
    baseURL: env.publicUrl,
    secret: env.betterAuthSecret,
    emailAndPassword: { enabled: true, disableSignUp: false, minPasswordLength: 12 },
    plugins: [organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true }), twoFactor()],
    logger: { disabled: true },
  });
}

describe('better-auth mounted behind the SDD-006 allowlist (WO-093)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  // The WO-094 host guard 404s any /api/auth/* request whose Host doesn't match PRDM_PUBLIC_URL;
  // every inject() below must present it to test allowlist behavior in isolation from that guard.
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

  test('every auth.api path outside the allowlist 404s with the shared error envelope', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const auth = buildAuth({ env, pool: pg.appPool, mailer });

    const disallowed = Object.values(auth.api)
      .map((endpoint) => endpoint.path)
      .filter((path): path is string => Boolean(path))
      .filter((path) => !AUTH_ALLOWED_PATHS.has(path));

    expect(disallowed.length).toBeGreaterThan(10);
    expect(disallowed).toContain('/sign-up/email');
    expect(disallowed).toContain('/organization/create');

    for (const path of disallowed) {
      const res = await app.inject({ method: 'POST', url: `/api/auth${path}`, payload: {}, headers: AUTH_HOST });
      expect(res.statusCode, `expected 404 for disallowed path ${path}`).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
    }

    await app.close();
  });

  test('no organization mutation endpoint is reachable over HTTP', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    for (const path of ORGANIZATION_MUTATION_PATHS) {
      const res = await app.inject({ method: 'POST', url: `/api/auth${path}`, payload: {}, headers: AUTH_HOST });
      expect(res.statusCode, `expected 404 for organization mutation path ${path}`).toBe(404);
    }

    await app.close();
  });

  test('allowlisted paths reach better-auth instead of the Fastify not_found handler', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const notFoundEnvelope = { error: { code: 'not_found', message: 'route not found' } };

    const getSession = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: AUTH_HOST });
    expect(getSession.json()).not.toEqual(notFoundEnvelope);

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: 'nope@example.test', password: 'whatever12345' },
      headers: AUTH_HOST,
    });
    expect(signIn.json()).not.toEqual(notFoundEnvelope);

    await app.close();
  });

  test('sign-in/email works end-to-end over HTTP against the real drizzle-backed tables', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(email);
    expect(res.headers['set-cookie']).toBeDefined();

    await app.close();
  });

  test('sign-up/email is unreachable (public sign-up disabled) even though better-auth still exposes it internally', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { name: 'Nope', email: `${randomUUID()}@example.test`, password: 'whatever12345' },
      headers: AUTH_HOST,
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  test('update-user only accepts "name"; any other field is rejected', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const signIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    const cookie = signIn.headers['set-cookie'];
    expect(cookie).toBeDefined();
    const cookieHeader = (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;

    // `/update-user` itself is outside the allowlist (SDD-006 restricts organization/member mutation
    // to `/api/app/*`, and this slice never mounts it), so the field restriction is asserted directly
    // against `auth.api` — proving the guard exists even though the HTTP route stays 404 either way.
    const auth = buildAuth({ env, pool: pg.appPool, mailer });
    await expect(
      auth.api.updateUser({ headers: new Headers({ cookie: cookieHeader }), body: { name: 'ok', image: 'https://evil.example/x.png' } }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' });

    await expect(auth.api.updateUser({ headers: new Headers({ cookie: cookieHeader }), body: { name: 'ok' } })).resolves.toMatchObject({
      status: true,
    });

    await app.close();
  });

  test('change-email and delete-user are disabled', async () => {
    const mailer = new FakeMailer();
    const auth = buildAuth({ env, pool: pg.appPool, mailer });

    expect(Object.values(auth.api).some((endpoint) => endpoint.path === '/change-email')).toBe(true);
    expect(AUTH_ALLOWED_PATHS.has('/change-email')).toBe(false);
    expect(AUTH_ALLOWED_PATHS.has('/delete-user')).toBe(false);
  });
});
