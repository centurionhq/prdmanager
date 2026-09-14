/**
 * WO-095 — per-IP and per-account rate limiting on sign-in, request-password-reset and
 * change-password (SDD-006 §Autenticación). Uses `createClockStore` with a manually-advanced fake
 * clock so window expiry is asserted with no real `sleep`. Runs against the real test Postgres
 * instance (5433) since these routes reach better-auth's drizzle adapter once allowed through.
 */
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connect, schema } from '@prdm/db';
import { openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { createClockStore } from '../../src/rate-limit/clock-store.js';
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
    logger: { disabled: true },
  });
}

/** A mutable fake clock: tests advance `current` directly instead of sleeping. */
function fakeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('per-IP and per-account rate limiting on auth routes (WO-095)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterAll(async () => {
    await pg.close();
  });

  afterEach(async () => {
    await app?.close();
  });

  async function seedUser(password = 'correct-horse-battery-staple'): Promise<{ email: string }> {
    const seedAuth = buildSeedAuth(env, pg.appPool);
    const email = `${randomUUID()}@example.test`;
    await seedAuth.api.signUpEmail({ body: { name: 'Test User', email, password } });
    return { email };
  }

  test('blocks the 6th sign-in attempt for the same account within the window, with a 429 envelope', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const clock = fakeClock();
    app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, rateLimitStore: createClockStore(clock.now) });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email, password: 'wrong-password' },
        headers: AUTH_HOST,
      });
      expect(res.statusCode, `attempt ${attempt} should not be rate-limited yet`).not.toBe(429);
    }

    const sixth = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password: 'wrong-password' },
      headers: AUTH_HOST,
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toEqual({ error: { code: 'rate_limited', message: 'rate limited' } });
    expect(sixth.headers['retry-after']).toBeDefined();
  });

  test('recovers once the fake clock advances past the time window (no sleep)', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const clock = fakeClock();
    app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, rateLimitStore: createClockStore(clock.now) });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    expect(blocked.statusCode).toBe(429);

    clock.advance(15 * 60_000 + 1);

    const afterWindow = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
      headers: AUTH_HOST,
    });
    expect(afterWindow.statusCode).toBe(200);
  });

  test('two different accounts from different IPs get independent account-scoped counters', async () => {
    // Distinct `remoteAddress` per account isolates the IP-scoped counter, so a block here can only
    // come from the account-scoped one — proving the two dimensions are genuinely independent.
    const password = 'correct-horse-battery-staple';
    const { email: emailA } = await seedUser(password);
    const { email: emailB } = await seedUser(password);
    const clock = fakeClock();
    app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, rateLimitStore: createClockStore(clock.now) });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email: emailA, password },
        headers: AUTH_HOST,
        remoteAddress: '10.0.0.1',
      });
    }
    const blockedA = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: emailA, password },
      headers: AUTH_HOST,
      remoteAddress: '10.0.0.1',
    });
    expect(blockedA.statusCode).toBe(429);

    const stillAllowedB = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: emailB, password },
      headers: AUTH_HOST,
      remoteAddress: '10.0.0.2',
    });
    expect(stillAllowedB.statusCode).toBe(200);
  });

  test('the same account attempted from two different IPs is still blocked by the account-scoped counter', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const clock = fakeClock();
    app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, rateLimitStore: createClockStore(clock.now) });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email, password },
        headers: AUTH_HOST,
        remoteAddress: `10.0.1.${attempt}`,
      });
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
      headers: AUTH_HOST,
      remoteAddress: '10.0.1.99',
    });
    expect(blocked.statusCode).toBe(429);
  });

  test('request-password-reset is rate-limited per account, independent of sign-in', async () => {
    const { email } = await seedUser();
    const clock = fakeClock();
    const mailer = new FakeMailer();
    app = buildServer({ env, pool: pg.appPool, mailer, logger: false, rateLimitStore: createClockStore(clock.now) });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email }, headers: AUTH_HOST });
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email }, headers: AUTH_HOST });

    expect(blocked.statusCode).toBe(429);
    expect(mailer.messages).toHaveLength(5);
  });

  test('change-password is rate-limited per session (account dimension), not just per IP', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await seedUser(password);
    const clock = fakeClock();
    app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, rateLimitStore: createClockStore(clock.now) });

    const signIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password }, headers: AUTH_HOST });
    const cookie = (Array.isArray(signIn.headers['set-cookie']) ? signIn.headers['set-cookie'][0] : signIn.headers['set-cookie'])!.split(';')[0]!;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        payload: { currentPassword: 'wrong-password', newPassword: 'another-new-password12' },
        headers: { ...AUTH_HOST, cookie },
      });
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: 'wrong-password', newPassword: 'another-new-password12' },
      headers: { ...AUTH_HOST, cookie },
    });

    expect(blocked.statusCode).toBe(429);
  });
});
