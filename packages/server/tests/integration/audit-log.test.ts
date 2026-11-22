/**
 * WO-342 — `GET .../projects/:projectSlug/audit-log` (project admin, `manage_project_settings`) and
 * `GET .../organizations/:orgSlug/audit-log` (org owner/admin only): keyset-paginated, redacted audit
 * trails. Includes a canary test confirming a real issued secret never appears in the response, on top
 * of `@prdm/db`'s own write-time `assertNoSecretsInAuditMetadata` guard.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('GET .../audit-log (project and organization) (WO-342)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const PASSWORD = 'correct-horse-battery-staple';
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
    env = buildTestServerEnv({ neo4j: config.neo4j });
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  function buildApp() {
    return buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j });
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  test('editor is forbidden; project admin sees project-scoped entries', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const ownerCookie = await signIn(app, owner.email);
    const editorCookie = await signIn(app, editor.email);

    await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/settings`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { settings: {} },
    });

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log`,
      headers: { ...AUTH_HOST(), cookie: editorCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: { action: string }[] };
    expect(body.entries.some((e) => e.action === 'project.settings.updated')).toBe(true);

    await app.close();
  });

  test('a plain org member is forbidden from the org-wide audit log; owner sees it, and a CI token secret never leaks into it', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const member = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const ownerCookie = await signIn(app, owner.email);
    const memberCookie = await signIn(app, member.email);

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { name: 'ci token', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(created.statusCode).toBe(200);
    const secret = created.json().secret as string;

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/audit-log`,
      headers: { ...AUTH_HOST(), cookie: memberCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/audit-log`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(secret);
    const body = res.json() as { entries: { action: string; metadata: Record<string, unknown> }[] };
    expect(body.entries.some((e) => e.action === 'token.ci.created')).toBe(true);

    await app.close();
  });

  type ActorEntry = { action: string; actor: { type: string; id: string; name?: string | null } };

  async function seedOrgWithProject() {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    return { owner, org, project };
  }

  async function getEntries(app: ReturnType<typeof buildServer>, url: string, cookie: string): Promise<ActorEntry[]> {
    const res = await app.inject({ method: 'GET', url, headers: { ...AUTH_HOST(), cookie } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { entries: ActorEntry[] }).entries;
  }

  test('resolves actor.name: real user name, token name, and null for an actor with no row (project and org endpoints)', async () => {
    const app = buildApp();
    const { owner, org, project } = await seedOrgWithProject();
    const ownerCookie = await signIn(app, owner.email);
    const projectUrl = `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log`;
    const orgUrl = `/api/app/organizations/${org.slug}/audit-log`;

    await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/settings`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { settings: {} },
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { name: 'ci token', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(created.statusCode).toBe(200);
    const tokenId = created.json().token.id as string;
    const audit = createTenantDb(pg.appPool).forOrg(org.id).auditLog;
    await audit.record({ projectId: project.id, actorType: 'token', actorId: tokenId, action: 'mcp.tool_call', target: 'search_nodes', metadata: { tool: 'search_nodes' } });
    await audit.record({ projectId: project.id, actorType: 'user', actorId: 'no-such-user-id', action: 'ghost.action', target: 'x', metadata: {} });
    await pg.ownerPool.query(
      `INSERT INTO "audit_log" (org_id, project_id, actor_type, actor_id, action, target, metadata)
       VALUES ($1, $2, 'agent', 'agent:prdm-reviewer', 'document.impacts_paths_synced', 'SDD-009', '{}')`,
      [org.id, project.id],
    );
    const { rows } = await pg.ownerPool.query<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [owner.id]);
    const ownerName = rows[0]!.name;

    for (const url of [projectUrl, orgUrl]) {
      const entries = await getEntries(app, url, ownerCookie);
      const byUser = entries.find((e) => e.action === 'project.settings.updated')!;
      expect(byUser.actor.id).toBe(owner.id);
      expect(byUser.actor.name).toBe(ownerName);

      const byToken = entries.find((e) => e.action === 'mcp.tool_call')!;
      expect(byToken.actor.id).toBe(tokenId);
      expect(byToken.actor.name).toBe('ci token');
      expect(byToken.actor.name).not.toBe(tokenId);

      const byAgent = entries.find((e) => e.action === 'document.impacts_paths_synced')!;
      expect(byAgent.actor).toEqual({ type: 'agent', id: 'agent:prdm-reviewer', name: 'prdm-reviewer' });
      expect(byAgent.actor.name).not.toContain('agent:');
      expect(byAgent.actor.name).not.toBe(byAgent.actor.id);

      const ghost = entries.find((e) => e.action === 'ghost.action')!;
      expect(ghost.actor.id).toBe('no-such-user-id');
      expect(ghost.actor.name).toBeNull();
    }

    await app.close();
  });

  // --- WO-704 (SDD-091): filtros en el servidor, total y facetas ---
  async function insertAudit(orgId: string, projectId: string | null, actorType: string, actorId: string, action: string, createdAt?: Date): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "audit_log" (org_id, project_id, actor_type, actor_id, action, target, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, 'x', '{}', COALESCE($6, now()))`,
      [orgId, projectId, actorType, actorId, action, createdAt ?? null],
    );
  }

  async function getJson<T>(app: ReturnType<typeof buildServer>, url: string, cookie: string): Promise<T> {
    const res = await app.inject({ method: 'GET', url, headers: { ...AUTH_HOST(), cookie } });
    expect(res.statusCode).toBe(200);
    return res.json() as T;
  }

  type Page = { entries: ActorEntry[]; total?: number };

  test('from/to filter on created_at is inclusive at the exact edges; a bare date covers the whole day', async () => {
    const app = buildApp();
    const { owner, org, project } = await seedOrgWithProject();
    const cookie = await signIn(app, owner.email);
    const from = new Date('2026-03-10T10:00:00.000Z');
    const to = new Date('2026-03-10T12:00:00.000Z');
    await insertAudit(org.id, project.id, 'user', 'u1', 'edge.before', new Date(from.getTime() - 1000));
    await insertAudit(org.id, project.id, 'user', 'u1', 'edge.from', from);
    await insertAudit(org.id, project.id, 'user', 'u1', 'edge.to', to);
    await insertAudit(org.id, project.id, 'user', 'u1', 'edge.after', new Date(to.getTime() + 1000));
    const url = `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log`;

    const page = await getJson<Page>(app, `${url}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, cookie);
    expect(page.entries.map((e) => e.action).sort()).toEqual(['edge.from', 'edge.to']);
    expect(page.total).toBe(2);

    await insertAudit(org.id, project.id, 'user', 'u1', 'day.noon', new Date('2026-04-05T12:00:00.000Z'));
    const day = await getJson<Page>(app, `${url}?from=2026-04-05&to=2026-04-05`, cookie);
    expect(day.entries.map((e) => e.action)).toEqual(['day.noon']);

    await app.close();
  });

  test('action is exact and actor filters narrow by (actorType, actorId); combined filters intersect', async () => {
    const app = buildApp();
    const { owner, org, project } = await seedOrgWithProject();
    const cookie = await signIn(app, owner.email);
    await insertAudit(org.id, project.id, 'user', 'A', 'x');
    await insertAudit(org.id, project.id, 'user', 'A', 'x.y');
    await insertAudit(org.id, project.id, 'user', 'B', 'x');
    await insertAudit(org.id, project.id, 'token', 'C', 'z');
    const url = `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log`;

    const byActor = await getJson<Page>(app, `${url}?actorType=user&actorId=A`, cookie);
    expect(byActor.entries.map((e) => e.action).sort()).toEqual(['x', 'x.y']);
    const byAction = await getJson<Page>(app, `${url}?action=x`, cookie);
    expect(byAction.entries.map((e) => e.actor.id).sort()).toEqual(['A', 'B']);
    const both = await getJson<Page>(app, `${url}?action=x&actorType=user&actorId=A`, cookie);
    expect(both.entries).toHaveLength(1);
    expect(both.entries[0]!.actor.id).toBe('A');
    expect(both.entries[0]!.action).toBe('x');

    await app.close();
  });

  test('total matches an independent count, ignores the cursor, and is scoped (project vs organization)', async () => {
    const app = buildApp();
    const { owner, org, project } = await seedOrgWithProject();
    const other = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    await insertAudit(org.id, project.id, 'user', 'A', 'a.one');
    await insertAudit(org.id, project.id, 'user', 'A', 'a.one');
    await insertAudit(org.id, project.id, 'user', 'A', 'a.two');
    await insertAudit(org.id, other.id, 'user', 'A', 'a.one');
    await insertAudit(org.id, null, 'user', 'A', 'a.one');
    const projectUrl = `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log`;
    const orgUrl = `/api/app/organizations/${org.slug}/audit-log`;

    const filtered = await getJson<Page>(app, `${orgUrl}?action=a.one`, cookie);
    const { rows } = await pg.ownerPool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "audit_log" WHERE org_id = $1 AND action = 'a.one'`, [org.id]);
    expect(filtered.total).toBe(rows[0]!.n);
    expect(filtered.total).toBe(4);

    expect((await getJson<Page>(app, projectUrl, cookie)).total).toBe(3);
    const paged = await getJson<Page & { nextCursor: string | null }>(app, `${projectUrl}?limit=1`, cookie);
    expect(paged.entries).toHaveLength(1);
    expect(paged.total).toBe(3);
    const second = await getJson<Page>(app, `${projectUrl}?limit=1&cursor=${paged.nextCursor}`, cookie);
    expect(second.total).toBe(3);
    const orgTotal = await pg.ownerPool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "audit_log" WHERE org_id = $1`, [org.id]);
    expect((await getJson<Page>(app, orgUrl, cookie)).total).toBe(orgTotal.rows[0]!.n);

    await app.close();
  });

  type Facets = { actions: { action: string; count: number }[]; actors: { type: string; id: string; name: string | null; count: number }[]; total: number };

  test('facets: exact counts, resolved names (null for unknown actors), scoped to the project vs the whole org', async () => {
    const app = buildApp();
    const { owner, org, project } = await seedOrgWithProject();
    const other = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    const { rows } = await pg.ownerPool.query<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [owner.id]);
    await insertAudit(org.id, project.id, 'user', owner.id, 'doc.edit');
    await insertAudit(org.id, project.id, 'user', owner.id, 'doc.edit');
    await insertAudit(org.id, project.id, 'user', 'no-such-user-id', 'ghost.action');
    await insertAudit(org.id, other.id, 'token', 'other-token', 'other.action');
    await insertAudit(org.id, null, 'user', owner.id, 'org.level');
    const base = `/api/app/organizations/${org.slug}`;

    const projectFacets = await getJson<Facets>(app, `${base}/projects/${project.slug}/audit-log/facets`, cookie);
    expect(projectFacets.actions).toEqual([
      { action: 'doc.edit', count: 2 },
      { action: 'ghost.action', count: 1 },
    ]);
    expect(projectFacets.actors).toEqual([
      { type: 'user', id: owner.id, name: rows[0]!.name, count: 2 },
      { type: 'user', id: 'no-such-user-id', name: null, count: 1 },
    ]);
    expect(projectFacets.total).toBe(3);

    const orgFacets = await getJson<Facets>(app, `${base}/audit-log/facets`, cookie);
    expect(orgFacets.actions.map((a) => a.action).sort()).toEqual(['doc.edit', 'ghost.action', 'org.level', 'other.action']);
    expect(orgFacets.actors.some((a) => a.id === 'other-token')).toBe(true);
    expect(orgFacets.total).toBe(5);

    await app.close();
  });

  test('facets permissions mirror the listing: editor 403, outsider 404, plain org member 403', async () => {
    const app = buildApp();
    const { owner, org, project } = await seedOrgWithProject();
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const outsider = await seedUser(env, pg.appPool, PASSWORD);
    const member = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: outsider.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const projectFacetsUrl = `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log/facets`;
    const listUrl = `/api/app/organizations/${org.slug}/projects/${project.slug}/audit-log`;
    const orgFacetsUrl = `/api/app/organizations/${org.slug}/audit-log/facets`;
    const cookies = new Map<string, string>();
    for (const u of [editor, outsider, member, owner]) cookies.set(u.email, await signIn(app, u.email));
    const status = async (url: string, email: string) =>
      (await app.inject({ method: 'GET', url, headers: { ...AUTH_HOST(), cookie: cookies.get(email)! } })).statusCode;

    expect(await status(projectFacetsUrl, editor.email)).toBe(403);
    expect(await status(projectFacetsUrl, outsider.email)).toBe(await status(listUrl, outsider.email));
    expect(await status(projectFacetsUrl, outsider.email)).toBe(404);
    expect(await status(orgFacetsUrl, member.email)).toBe(403);
    expect(await status(projectFacetsUrl, owner.email)).toBe(200);

    await app.close();
  });
});
