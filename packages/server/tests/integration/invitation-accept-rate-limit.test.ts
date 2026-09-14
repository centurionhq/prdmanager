/**
 * WO-105 — `POST /api/app/invitations/:id/accept` is rate-limited (per IP and, once resolved, per
 * invited email) exactly like sign-in/reset/change-password (WO-095's `createKeyedRateLimiter`). Uses a
 * fake-clock rate-limit store so window expiry never needs a real `sleep`.
 */
import { createMemberFixture, createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { createClockStore } from '../../src/rate-limit/clock-store.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

function fakeClock(startMs = 0) {
  let current = startMs;
  return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
}

describe('rate limiting on invitation acceptance (WO-105)', () => {
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

  test('repeated wrong-secret attempts against the same id are rate-limited by IP', async () => {
    const clock = fakeClock();
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false, rateLimitStore: createClockStore(clock.now) });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    const create = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/invitations`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { email: 'target@example.test', role: 'member' },
    });
    const match = /\/invite\/([^#\s]+)#s=/.exec(mailer.messages[0]!.text);
    const invitationId = match![1]!;
    expect(create.statusCode).toBe(200);

    const acceptHeaders = await mutationHeaders(app, AUTH_HOST, ORIGIN);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/app/invitations/${invitationId}/accept`,
        headers: acceptHeaders,
        payload: { secret: 'wrong', name: 'X', password: PASSWORD },
      });
      expect(res.statusCode, `attempt ${attempt} should not be rate-limited yet`).toBe(404);
    }

    const eleventh = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${invitationId}/accept`,
      headers: acceptHeaders,
      payload: { secret: 'wrong', name: 'X', password: PASSWORD },
    });
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json()).toEqual({ error: { code: 'rate_limited', message: 'rate limited' } });

    clock.advance(15 * 60_000 + 1);
    const afterWindow = await app.inject({
      method: 'POST',
      url: `/api/app/invitations/${invitationId}/accept`,
      headers: acceptHeaders,
      payload: { secret: 'wrong', name: 'X', password: PASSWORD },
    });
    expect(afterWindow.statusCode).toBe(404);

    await app.close();
  });
});
