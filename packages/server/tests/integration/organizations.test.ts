/**
 * WO-104 — `/api/app/organizations/*`: listing, setting the active organization, and role/removal
 * mutations with the SDD-006 §Permisos last-owner and admin-vs-owner rules, over HTTP.
 */
import { createMemberFixture, createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('/api/app/organizations/* (WO-104)', () => {
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

  test('GET /api/app/organizations requires a session', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/app/organizations', headers: AUTH_HOST });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('GET /api/app/organizations lists every org the caller belongs to, with role', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: orgA.id, userId: user.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: orgB.id, userId: user.id, role: 'member' });
    const cookie = await signIn(app, user.email);

    const res = await app.inject({ method: 'GET', url: '/api/app/organizations', headers: { ...AUTH_HOST, cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.json().organizations).toEqual(
      expect.arrayContaining([
        { organizationId: orgA.id, slug: orgA.slug, name: orgA.name, role: 'owner' },
        { organizationId: orgB.id, slug: orgB.slug, name: orgB.name, role: 'member' },
      ]),
    );
    await app.close();
  });

  test('POST /api/app/organizations/active sets the session cookie and 404s for a non-member org', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    const otherOrg = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'member' });
    const cookie = await signIn(app, user.email);

    const notMember = await app.inject({
      method: 'POST',
      url: '/api/app/organizations/active',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { organizationId: otherOrg.id },
    });
    expect(notMember.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/app/organizations/active',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { organizationId: org.id },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['set-cookie']).toBeDefined();

    await app.close();
  });

  test('a cross-org member/role route 404s instead of leaking the org exists', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const orgOfSomeoneElse = await createOrganizationFixture(pg);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({ method: 'GET', url: `/api/app/organizations/${orgOfSomeoneElse.slug}/members`, headers: { ...AUTH_HOST, cookie } });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('an owner can promote a member to admin, audited in audit_log', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const target = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: target.id, role: 'member' });
    const cookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/members/${target.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: target.id, role: 'admin' });

    const { rows } = await pg.ownerPool.query(`SELECT action, actor_id, target, metadata FROM audit_log WHERE org_id = $1`, [org.id]);
    expect(rows).toEqual([
      { action: 'organization.member.role_changed', actor_id: owner.id, target: target.id, metadata: { role: 'admin' } },
    ]);

    await app.close();
  });

  test('an admin cannot demote or remove the last owner; a member cannot mutate roles at all', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const admin = await seedUser(env, pg.appPool, PASSWORD);
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const plainMember = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: admin.id, role: 'admin' });
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: plainMember.id, role: 'member' });

    const adminCookie = await signIn(app, admin.email);
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/members/${owner.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, adminCookie),
      payload: { role: 'member' },
    });
    expect(demote.statusCode).toBe(403);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/app/organizations/${org.slug}/members/${owner.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, adminCookie),
    });
    expect(remove.statusCode).toBe(403);

    const memberCookie = await signIn(app, plainMember.email);
    const memberTries = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/members/${admin.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, memberCookie),
      payload: { role: 'admin' },
    });
    expect(memberTries.statusCode).toBe(403);

    await app.close();
  });
});
