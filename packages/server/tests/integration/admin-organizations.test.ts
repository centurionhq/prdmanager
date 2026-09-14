/**
 * WO-101/WO-102 — `POST /api/app/admin/organizations`: superadmin-only, requires a 2FA-verified
 * session, creates the organization and invites its owner by email, with no membership left for the
 * superadmin itself.
 */
import { findMembership, findOrganizationBySlug, readPlatformAuditLog } from '@prdm/db';
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { bootstrapSuperadmin, type BootstrapPrompts } from '../../src/cli/bootstrap-superadmin.js';
import { FakeMailer } from '../../src/mailer.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { computeTotpCode } from '../helpers/totp.js';

describe('POST /api/app/admin/organizations (WO-101/WO-102)', () => {
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

  /** A sign-in response the two-factor plugin intercepted carries *two* Set-Cookie headers (one
   * expiring the credential sign-in's own session cookie, one setting the pending 2FA challenge
   * cookie) — `nameHint` picks the right one out by substring instead of assuming an order. */
  function findCookie(res: { headers: { 'set-cookie'?: string | string[] } }, nameHint: string): string {
    const cookies = res.headers['set-cookie'];
    const list = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const match = list.find((entry) => entry.includes(nameHint));
    if (!match) throw new Error(`no Set-Cookie header containing "${nameHint}" (got: ${JSON.stringify(list)})`);
    return match.split(';')[0]!;
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    return findCookie(res, 'session_token');
  }

  async function signInPendingTwoFactor(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    return findCookie(res, 'two_factor');
  }

  /** Bootstraps a superadmin, capturing its TOTP enrollment URI, then drives the real HTTP sign-in +
   * `/two-factor/verify-totp` challenge (WO-102) to obtain an actually 2FA-verified session cookie —
   * exactly what a superadmin's browser session would look like, never a shortcut around the plugin. */
  async function bootstrapAndSignInSuperadmin(app: ReturnType<typeof buildServer>, email: string): Promise<{ userId: string; cookie: string }> {
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

    const pendingCookie = await signInPendingTwoFactor(app, email);
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { ...AUTH_HOST, cookie: pendingCookie },
      payload: { code: computeTotpCode(totpUri!) },
    });
    if (verify.statusCode !== 200) {
      throw new Error(`verify-totp failed: ${verify.statusCode} ${verify.body}`);
    }
    return { userId: admin.userId, cookie: findCookie(verify, 'session_token') };
  }

  test('a non-superadmin session is forbidden', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/admin/organizations',
      headers: { ...AUTH_HOST, cookie },
      payload: { name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.test' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('no session at all is unauthorized', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/admin/organizations',
      headers: AUTH_HOST,
      payload: { name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.test' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('a superadmin with a sign-in session but no completed 2FA challenge is forbidden', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    let totpUri: string | undefined;
    await bootstrapSuperadmin({
      pool: pg.ownerPool,
      env,
      prompts: {
        email: async () => 'pending2fa@example.test',
        name: async () => 'Root',
        password: async () => PASSWORD,
        totpCode: async () => computeTotpCode(totpUri!),
      },
      log: (message) => {
        const match = /otpauth:\/\/\S+/.exec(message);
        if (match) totpUri = match[0];
      },
    });

    // Only the sign-in step, never the two-factor/verify-totp challenge: the cookie this yields is the
    // temporary 2FA-pending cookie, never a real session (see build-auth.ts / the two-factor plugin).
    const pendingCookie = await signInPendingTwoFactor(app, 'pending2fa@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/admin/organizations',
      headers: { ...AUTH_HOST, cookie: pendingCookie },
      payload: { name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.test' },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('a superadmin creates an org, invites its owner by email, and gets no membership in it', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const admin = await bootstrapAndSignInSuperadmin(app, 'root@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/admin/organizations',
      headers: { ...AUTH_HOST, cookie: admin.cookie },
      payload: { name: 'Acme Inc', slug: 'acme-inc', ownerEmail: 'owner@example.test' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('acme-inc');
    expect(body.invitationId).toBeDefined();

    const org = await findOrganizationBySlug(pg.appPool, 'acme-inc');
    expect(org).not.toBeNull();
    expect(await findMembership(pg.appPool, org!.id, admin.userId)).toBeNull();

    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]!.to).toBe('owner@example.test');
    expect(mailer.messages[0]!.text).toContain('Acme Inc');

    const auditEntries = await readPlatformAuditLog(pg.ownerPool, admin.userId);
    expect(auditEntries.some((entry) => entry.action === 'platform.organization.created' && entry.target === org!.id)).toBe(true);

    await app.close();
  });

  test('creating an organization with an already-taken slug conflicts', async () => {
    const mailer = new FakeMailer();
    const app = buildServer({ env, pool: pg.appPool, mailer, logger: false });
    const admin = await bootstrapAndSignInSuperadmin(app, 'root2@example.test');
    const payload = { name: 'Acme', slug: 'dup-slug', ownerEmail: 'owner@example.test' };

    const first = await app.inject({ method: 'POST', url: '/api/app/admin/organizations', headers: { ...AUTH_HOST, cookie: admin.cookie }, payload });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: '/api/app/admin/organizations', headers: { ...AUTH_HOST, cookie: admin.cookie }, payload });
    expect(second.statusCode).toBe(409);

    await app.close();
  });
});
