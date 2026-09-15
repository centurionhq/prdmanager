/**
 * WO-109 — `/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens`: project-admin only
 * (`manage_ci_tokens`), CI-only scopes enforced, `project_ids` always includes the project in the URL.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens (WO-109)', () => {
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

  test('an org owner can create a CI token scoped to the project; a plain project viewer cannot (403)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: viewer.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [
      project.id,
      viewer.id,
      org.id,
    ]);
    const ownerCookie = await signIn(app, owner.email);
    const viewerCookie = await signIn(app, viewer.email);

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { name: 'ci-pipeline', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.token.prefix).toMatch(/^prdm_ci_/);
    expect(body.token.projectIds).toEqual([project.id]);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, viewerCookie),
      payload: { name: 'ci-pipeline-2', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(forbidden.statusCode).toBe(403);

    await app.close();
  });

  test('a CI token cannot request mcp:read/mcp:write/import:write (personal-only scopes)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name: 'ci-pipeline', scopes: ['mcp:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('a CI token issued via GET /api/v1/me works, and once revoked, no longer does', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name: 'ci-pipeline', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const { secret, token } = created.json();

    const ok = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${secret}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toBeNull();
    expect(ok.json().tokenKind).toBe('project_ci');

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens/${token.id}/revoke`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
    });

    const revoked = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${secret}` } });
    expect(revoked.statusCode).toBe(401);

    await app.close();
  });
});
