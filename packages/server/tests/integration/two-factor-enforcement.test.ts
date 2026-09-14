/**
 * WO-102 — TOTP enforcement scope and `trustDevice` behavior:
 *  - `/api/app/admin/*` requires a 2FA-verified session (already exercised end-to-end against the real
 *    org-creation route in `admin-organizations.test.ts`); this file adds the negative case (a
 *    superadmin who signs back in a second time still gets a 2FA challenge, proving `trustDevice` never
 *    got honored) and the positive scoping case (a non-admin `/api/app/*` route never requires 2FA at
 *    all — SDD-006 only calls out `/admin` and org creation).
 */
import { isPlatformAdmin } from '@prdm/db';
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { bootstrapSuperadmin, type BootstrapPrompts } from '../../src/cli/bootstrap-superadmin.js';
import { FakeMailer } from '../../src/mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { computeTotpCode } from '../helpers/totp.js';

describe('TOTP enforcement scope (WO-102)', () => {
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

  function findCookie(res: { headers: { 'set-cookie'?: string | string[] } }, nameHint: string): string {
    const cookies = res.headers['set-cookie'];
    const list = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const match = list.find((entry) => entry.includes(nameHint));
    if (!match) throw new Error(`no Set-Cookie header containing "${nameHint}" (got: ${JSON.stringify(list)})`);
    return match.split(';')[0]!;
  }

  async function bootstrapSuperadminWithTotp(email: string): Promise<{ userId: string; totpUri: string }> {
    let totpUri: string | undefined;
    const prompts: BootstrapPrompts = {
      email: async () => email,
      name: async () => 'Root',
      password: async () => PASSWORD,
      totpCode: async () => computeTotpCode(totpUri!),
    };
    const admin = await bootstrapSuperadmin({
      pool: pg.ownerPool,
      env,
      prompts,
      log: (message) => {
        const match = /otpauth:\/\/\S+/.exec(message);
        if (match) totpUri = match[0];
      },
    });
    return { userId: admin.userId, totpUri: totpUri! };
  }

  test('signing in a second time still challenges 2FA: trustDevice is never honored for superadmins', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { totpUri } = await bootstrapSuperadminWithTotp('trust-device-test@example.test');

    // First sign-in + a verify-totp call that *asks* for trustDevice: true.
    const firstSignIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: 'trust-device-test@example.test', password: PASSWORD },
      headers: AUTH_HOST,
    });
    const firstPending = findCookie(firstSignIn, 'two_factor');
    const firstVerify = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { ...AUTH_HOST, cookie: firstPending },
      payload: { code: computeTotpCode(totpUri), trustDevice: true },
    });
    expect(firstVerify.statusCode).toBe(200);
    // The before-hook (build-auth.ts) forces trustDevice off, so no trust_device cookie is ever set.
    const setCookies = firstVerify.headers['set-cookie'];
    const list = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    expect(list.some((c) => c.includes('trust_device'))).toBe(false);

    // Signing in again still gets a 2FA challenge, not a real session straight away.
    const secondSignIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: 'trust-device-test@example.test', password: PASSWORD },
      headers: AUTH_HOST,
    });
    expect(secondSignIn.json()).toMatchObject({ twoFactorRedirect: true });

    await app.close();
  });

  test('/api/app/organizations (non-admin) never requires 2FA, even for an account that has it enrolled', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { userId, totpUri } = await bootstrapSuperadminWithTotp('has-2fa-not-admin-route@example.test');
    expect(await isPlatformAdmin(pg.appPool, userId)).toBe(true);

    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: 'has-2fa-not-admin-route@example.test', password: PASSWORD },
      headers: AUTH_HOST,
    });
    const pending = findCookie(signIn, 'two_factor');
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { ...AUTH_HOST, cookie: pending },
      payload: { code: computeTotpCode(totpUri) },
    });
    const sessionCookie = findCookie(verify, 'session_token');

    const res = await app.inject({ method: 'GET', url: '/api/app/organizations', headers: { ...AUTH_HOST, cookie: sessionCookie } });

    // Reaches the route logic (200, empty list) rather than a 401/403 from a 2FA gate that doesn't
    // apply here.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ organizations: [] });

    await app.close();
  });
});
