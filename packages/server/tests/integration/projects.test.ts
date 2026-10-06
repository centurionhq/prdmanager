/**
 * WO-107 — `/api/app/organizations/:orgSlug/projects/*`: list/create, get, settings updates, and
 * project membership, all scoped through `createTenantDb(pool).forOrg(...)` with SDD-006's visibility
 * and permission rules enforced over real HTTP.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('/api/app/organizations/:orgSlug/projects/* (WO-107)', () => {
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

  test('GET /api/app/organizations/:orgSlug/projects requires a session', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const org = await createOrganizationFixture(pg);
    const res = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects`, headers: AUTH_HOST });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('an org owner sees every project; a plain member only sees projects they have a project_members row in', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const member = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    const visible = await createProjectFixture(pg, { orgId: org.id, slug: 'visible-project' });
    const hidden = await createProjectFixture(pg, { orgId: org.id, slug: 'hidden-project' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [
      visible.id,
      member.id,
      org.id,
    ]);

    const ownerCookie = await signIn(app, owner.email);
    const ownerRes = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects`, headers: { ...AUTH_HOST, cookie: ownerCookie } });
    expect(ownerRes.statusCode).toBe(200);
    expect(ownerRes.json().projects.map((p: { slug: string }) => p.slug).sort()).toEqual(['hidden-project', 'visible-project']);

    const memberCookie = await signIn(app, member.email);
    const memberRes = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects`, headers: { ...AUTH_HOST, cookie: memberCookie } });
    expect(memberRes.statusCode).toBe(200);
    expect(memberRes.json().projects.map((p: { slug: string }) => p.slug)).toEqual(['visible-project']);

    await app.close();
  });

  test('a plain member without a project_members row 404s on GET :projectSlug (never 403)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const member = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, member.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}`,
      headers: { ...AUTH_HOST, cookie },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('a project in another organization 404s, and so does a nonexistent slug in the caller\'s own org', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const otherOrg = await createOrganizationFixture(pg);
    const projectInOtherOrg = await createProjectFixture(pg, { orgId: otherOrg.id });
    const cookie = await signIn(app, owner.email);

    const crossOrg = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${projectInOtherOrg.slug}`,
      headers: { ...AUTH_HOST, cookie },
    });
    expect(crossOrg.statusCode).toBe(404);

    const nonexistent = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/does-not-exist`,
      headers: { ...AUTH_HOST, cookie },
    });
    expect(nonexistent.statusCode).toBe(404);

    await app.close();
  });

  test('POST creates a project with a server-generated graph_project_id and default-filled settings, audited', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { slug: 'roadmap', name: 'Roadmap' },
    });

    expect(res.statusCode).toBe(200);
    const { project } = res.json();
    expect(project.slug).toBe('roadmap');
    expect(project.graphProjectId).toMatch(/^prj_[0-9a-f]{16}$/);
    expect(project.settings.default_branch).toBe('main');

    const { rows } = await pg.ownerPool.query(`SELECT action, target FROM audit_log WHERE org_id = $1`, [org.id]);
    expect(rows).toEqual([{ action: 'project.created', target: project.id }]);

    await app.close();
  });

  test('POST rejects a duplicate slug within the same org with 409, and a plain member with 403', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const member = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    await createProjectFixture(pg, { orgId: org.id, slug: 'roadmap' });
    const ownerCookie = await signIn(app, owner.email);

    const dup = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { slug: 'roadmap', name: 'Roadmap Again' },
    });
    expect(dup.statusCode).toBe(409);

    const memberCookie = await signIn(app, member.email);
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, memberCookie),
      payload: { slug: 'another', name: 'Another' },
    });
    expect(forbidden.statusCode).toBe(403);

    await app.close();
  });

  test('PATCH settings: admin (project or inherited org) can update, editor cannot (403), audited with a sanitized diff', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [
      project.id,
      editor.id,
      org.id,
    ]);

    const editorCookie = await signIn(app, editor.email);
    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/settings`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { settings: { default_branch: 'trunk' } },
    });
    expect(forbidden.statusCode).toBe(403);

    const ownerCookie = await signIn(app, owner.email);
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/settings`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { settings: { default_branch: 'trunk' } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().project.settings.default_branch).toBe('trunk');

    const { rows } = await pg.ownerPool.query(`SELECT action, metadata FROM audit_log WHERE org_id = $1 AND action = 'project.settings.updated'`, [
      org.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.after.default_branch).toBe('trunk');

    await app.close();
  });

  test('project members: admin adds/changes/removes, editor is forbidden, target user in another project 404s', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const target = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: target.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [
      project.id,
      editor.id,
      org.id,
    ]);
    const ownerCookie = await signIn(app, owner.email);
    const editorCookie = await signIn(app, editor.email);

    const add = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { userId: target.id, role: 'viewer' },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json()).toEqual({ userId: target.id, role: 'viewer' });

    const editorForbidden = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members/${target.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { role: 'editor' },
    });
    expect(editorForbidden.statusCode).toBe(403);

    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members/${target.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { role: 'editor' },
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json()).toEqual({ userId: target.id, role: 'editor' });

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members/${target.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
    });
    expect(remove.statusCode).toBe(200);

    const missing = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members/${target.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
      payload: { role: 'viewer' },
    });
    expect(missing.statusCode).toBe(404);

    const { rows } = await pg.ownerPool.query(`SELECT action FROM audit_log WHERE org_id = $1 ORDER BY created_at`, [org.id]);
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['project.member.added', 'project.member.role_changed', 'project.member.removed']);

    await app.close();
  });

  test('removing a member from a project revokes their personal tokens scoped to that project (WO-257)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const target = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: target.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO project_members (project_id, org_id, user_id, role) VALUES ($1, $2, $3, 'developer')`, [project.id, org.id, target.id]);
    const ownerCookie = await signIn(app, owner.email);
    const targetCookie = await signIn(app, target.email);

    const scopedToken = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, targetCookie),
      payload: { orgSlug: org.slug, name: 'scoped', scopes: ['mcp:read'], projectIds: [project.id], expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(scopedToken.statusCode).toBe(200);
    const unscopedToken = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, targetCookie),
      payload: { orgSlug: org.slug, name: 'unscoped', scopes: ['mcp:read'], expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(unscopedToken.statusCode).toBe(200);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members/${target.id}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
    });
    expect(remove.statusCode).toBe(200);

    const { rows } = await pg.ownerPool.query(`SELECT name, revoked_at FROM api_tokens WHERE org_id = $1 AND user_id = $2 ORDER BY name`, [org.id, target.id]);
    const byName = Object.fromEntries(rows.map((r: { name: string; revoked_at: string | null }) => [r.name, r.revoked_at]));
    expect(byName.scoped).not.toBeNull();
    // Unscoped ("every project I can see") is deliberately left alone — the target user may still have
    // other projects it legitimately covers.
    expect(byName.unscoped).toBeNull();

    await app.close();
  });

  describe('POST .../archive and .../unarchive (WO-661)', () => {
    async function setup(projectRole?: 'editor') {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const user = await seedUser(env, pg.appPool, PASSWORD);
      const org = await createOrganizationFixture(pg);
      await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: projectRole === undefined ? 'owner' : 'member' });
      const project = await createProjectFixture(pg, { orgId: org.id });
      return { app, user, org, project, cookie: await signIn(app, user.email) };
    }

    const post = async (ctx: Awaited<ReturnType<typeof setup>>, action: 'archive' | 'unarchive') =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/app/organizations/${ctx.org.slug}/projects/${ctx.project.slug}/${action}`,
        headers: await mutationHeaders(ctx.app, AUTH_HOST, ORIGIN, ctx.cookie),
      });

    const auditRows = async (projectId: string, action: string) =>
      (await pg.ownerPool.query(`SELECT target, metadata FROM audit_log WHERE project_id = $1 AND action = $2`, [projectId, action])).rows;

    test('archive writes archived_at and records exactly one project.archived audit row', async () => {
      const ctx = await setup();
      const res = await post(ctx, 'archive');
      expect(res.statusCode).toBe(200);
      expect(res.json().project.archivedAt).not.toBeNull();

      const { rows } = await pg.ownerPool.query(`SELECT archived_at FROM projects WHERE id = $1`, [ctx.project.id]);
      expect(rows[0].archived_at).not.toBeNull();
      const audit = await auditRows(ctx.project.id, 'project.archived');
      expect(audit).toHaveLength(1);
      expect(audit[0].target).toBe(ctx.project.id);
      expect(audit[0].metadata.slug).toBe(ctx.project.slug);
      await ctx.app.close();
    });

    test('archiving twice is idempotent: same archivedAt and a single audit row', async () => {
      const ctx = await setup();
      const first = await post(ctx, 'archive');
      const second = await post(ctx, 'archive');
      expect(second.statusCode).toBe(200);
      expect(second.json().project.archivedAt).toBe(first.json().project.archivedAt);
      expect(await auditRows(ctx.project.id, 'project.archived')).toHaveLength(1);
      await ctx.app.close();
    });

    test('unarchive clears archived_at with an audit row; unarchiving an active project is a silent no-op', async () => {
      const ctx = await setup();
      await pg.ownerPool.query(`UPDATE projects SET archived_at = now() WHERE id = $1`, [ctx.project.id]);

      const res = await post(ctx, 'unarchive');
      expect(res.statusCode).toBe(200);
      expect(res.json().project.archivedAt).toBeNull();
      const { rows } = await pg.ownerPool.query(`SELECT archived_at FROM projects WHERE id = $1`, [ctx.project.id]);
      expect(rows[0].archived_at).toBeNull();
      expect(await auditRows(ctx.project.id, 'project.unarchived')).toHaveLength(1);

      const again = await post(ctx, 'unarchive');
      expect(again.statusCode).toBe(200);
      expect(again.json().project.archivedAt).toBeNull();
      expect(await auditRows(ctx.project.id, 'project.unarchived')).toHaveLength(1);
      await ctx.app.close();
    });

    test('a project editor lacks the archive permission: 403 on both routes', async () => {
      const ctx = await setup('editor');
      await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [
        ctx.project.id,
        ctx.user.id,
        ctx.org.id,
      ]);
      expect((await post(ctx, 'archive')).statusCode).toBe(403);
      expect((await post(ctx, 'unarchive')).statusCode).toBe(403);
      await ctx.app.close();
    });

    test('an org member without a project_members row gets 404 on both routes', async () => {
      const ctx = await setup('editor');
      expect((await post(ctx, 'archive')).statusCode).toBe(404);
      expect((await post(ctx, 'unarchive')).statusCode).toBe(404);
      await ctx.app.close();
    });
  });
});
