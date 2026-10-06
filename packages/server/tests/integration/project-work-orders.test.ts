/**
 * WO-338 — `GET .../work-orders/:woId/context`, `POST .../claim`, `POST .../complete`: the HTTP
 * equivalent of the remote MCP `get_work_order_context`/`claim_work_order`/`complete_work_order` tools
 * (SDD-010, WO-186), gated by `view`/`claim_work_order`/`complete_work_order`. `assignee` defaults to
 * `dev:<user_profile.handle>`; `agent:<name>` or the own handle may be requested (SDD-086), plus `POST .../batch`.
 */
import { randomUUID } from 'node:crypto';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('GET/POST .../work-orders/:woId/{context,claim,complete} (WO-338)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const PASSWORD = 'correct-horse-battery-staple';

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

  async function setupProjectWithWorkOrder() {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const handle = `dev-${randomUUID().slice(0, 8)}`;
    await pg.ownerPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, $2)`, [owner.id, handle]);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'SDD-001', 'SDD', 'Design', 'docs/blueprints/SDD-001.md', 'generated', 'published', $3)`,
      [org.id, project.id, '---\nid: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/**"]\n---\n## Tareas\n- [ ] x\n'],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'WO-001', 'WO', 'Task', 'docs/work-orders/WO-001.md', 'generated', 'published', $3)`,
      [org.id, project.id, '---\nid: WO-001\ntype: WO\ntitle: Task\nstatus: pending\nimplements: [SDD-001]\n---\ntask\n'],
    );

    return { owner, handle, org, project };
  }

  async function insertWorkOrder(orgId: string, projectId: string, id: string, status: string) {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'WO', 'Task', $4, 'generated', 'published', $5)`,
      [orgId, projectId, id, `docs/work-orders/${id}.md`, `---\nid: ${id}\ntype: WO\ntitle: Task\nstatus: ${status}\nimplements: [SDD-001]\n---\ntask\n`],
    );
  }

  async function postBatch(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, cookie: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/batch`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, cookie),
      payload: payload as object,
    });
  }

  async function postClaim(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, cookie: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/claim`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, cookie),
      payload: payload as object,
    });
  }

  async function publishedStatus(projectId: string, id: string): Promise<string | undefined> {
    const { rows } = await pg.ownerPool.query(`SELECT published_raw FROM "documents" WHERE project_id = $1 AND doc_id = $2`, [projectId, id]);
    return /^status: "?([^"\s]+)"?$/m.exec(rows[0]?.published_raw ?? '')?.[1];
  }

  async function insertCommit(projectId: string, orgId: string, sha: string, trust: 'baseline' | 'preview', refs: string[]) {
    await pg.ownerPool.query(
      `INSERT INTO "commits" (project_id, org_id, sha, trust, author, date, subject, refs) VALUES ($1, $2, $3, $4, 'Alice', now(), 'x', $5)`,
      [projectId, orgId, sha, trust, refs],
    );
  }

  test('GET context 404s for an unknown work order', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-999/context`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  test('POST claim defaults to dev:<own handle>; another dev:<handle> is 403 and leaves the WO untouched', async () => {
    const app = buildApp();
    const { owner, handle, org, project } = await setupProjectWithWorkOrder();
    const ownerCookie = await signIn(app, owner.email);

    const res = await postClaim(app, org, project, ownerCookie, { assignee: 'dev:someone-else' });
    expect(res.statusCode).toBe(403);
    expect(await publishedStatus(project.id, 'WO-001')).toBe('pending');

    const ok = await postClaim(app, org, project, ownerCookie, {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().result).toMatchObject({ id: 'WO-001', status: 'in_progress', assignedTo: `dev:${handle}` });

    const { rows } = await pg.ownerPool.query(`SELECT action, target FROM audit_log WHERE project_id = $1 AND action = 'work_order.claimed'`, [project.id]);
    expect(rows).toHaveLength(1);

    await app.close();
  });

  test('POST claim accepts an agent:<name> assignee and audit-logs it', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    const ownerCookie = await signIn(app, owner.email);

    const res = await postClaim(app, org, project, ownerCookie, { assignee: 'agent:prdm-engineer' });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ status: 'in_progress', assignedTo: 'agent:prdm-engineer' });

    const { rows } = await pg.ownerPool.query(`SELECT metadata FROM audit_log WHERE project_id = $1 AND action = 'work_order.claimed'`, [project.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ assignee: 'agent:prdm-engineer' });

    await app.close();
  });

  test('POST claim accepts the caller\'s own dev:<handle> explicitly', async () => {
    const app = buildApp();
    const { owner, handle, org, project } = await setupProjectWithWorkOrder();
    const ownerCookie = await signIn(app, owner.email);

    const res = await postClaim(app, org, project, ownerCookie, { assignee: `dev:${handle}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ assignedTo: `dev:${handle}` });

    await app.close();
  });

  test('POST claim rejects a malformed assignee with 400', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    const ownerCookie = await signIn(app, owner.email);

    const res = await postClaim(app, org, project, ownerCookie, { assignee: 'bogus' });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('POST batch archive archives every pending work order and audit-logs each', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    await insertWorkOrder(org.id, project.id, 'WO-002', 'pending');
    const ownerCookie = await signIn(app, owner.email);

    const res = await postBatch(app, org, project, ownerCookie, { action: 'archive', ids: ['WO-001', 'WO-002'], reason: 'cleanup' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ results: [{ id: 'WO-001', ok: true }, { id: 'WO-002', ok: true }], archived: 2, claimed: 0 });
    expect(await publishedStatus(project.id, 'WO-001')).toBe('archived');
    expect(await publishedStatus(project.id, 'WO-002')).toBe('archived');

    const { rows } = await pg.ownerPool.query(`SELECT target FROM audit_log WHERE project_id = $1 AND action = 'work_order.archived'`, [project.id]);
    expect(rows).toHaveLength(2);

    await app.close();
  });

  test('POST batch is best-effort: a done work order fails on its own without aborting the rest', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    await insertWorkOrder(org.id, project.id, 'WO-002', 'done');
    const ownerCookie = await signIn(app, owner.email);

    const res = await postBatch(app, org, project, ownerCookie, { action: 'archive', ids: ['WO-002', 'WO-001'] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results[0]).toMatchObject({ id: 'WO-002', ok: false });
    expect(body.results[0].error).toBeTruthy();
    expect(body.results[1]).toMatchObject({ id: 'WO-001', ok: true });
    expect(body.archived).toBe(1);
    expect(await publishedStatus(project.id, 'WO-001')).toBe('archived');

    await app.close();
  });

  test('POST batch rejects an invalid action, empty ids and more than 200 ids with 400', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    const ownerCookie = await signIn(app, owner.email);

    expect((await postBatch(app, org, project, ownerCookie, { action: 'bogus', ids: ['WO-001'] })).statusCode).toBe(400);
    expect((await postBatch(app, org, project, ownerCookie, { action: 'archive', ids: [] })).statusCode).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `WO-${i + 1}`);
    expect((await postBatch(app, org, project, ownerCookie, { action: 'archive', ids: many })).statusCode).toBe(400);

    await app.close();
  });

  test('POST batch claim assigns the requested agent to every claimable work order', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    const ownerCookie = await signIn(app, owner.email);

    const res = await postBatch(app, org, project, ownerCookie, { action: 'claim', ids: ['WO-001'], assignee: 'agent:prdm-engineer' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ results: [{ id: 'WO-001', ok: true }], archived: 0, claimed: 1 });
    expect(await publishedStatus(project.id, 'WO-001')).toBe('in_progress');
    const { rows } = await pg.ownerPool.query(`SELECT published_raw FROM "documents" WHERE project_id = $1 AND doc_id = 'WO-001'`, [project.id]);
    expect(rows[0].published_raw).toContain('agent:prdm-engineer');

    await app.close();
  });

  test('POST batch archive is 403 for a project editor and archives nothing', async () => {
    const app = buildApp();
    const { org, project } = await setupProjectWithWorkOrder();
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const editorCookie = await signIn(app, editor.email);

    const res = await postBatch(app, org, project, editorCookie, { action: 'archive', ids: ['WO-001'] });
    expect(res.statusCode).toBe(403);
    expect(await publishedStatus(project.id, 'WO-001')).toBe('pending');

    await app.close();
  });

  test('POST complete rejects a preview-trust commit with 409 commit_not_verified_by_ci', async () => {
    const app = buildApp();
    const { owner, handle, org, project } = await setupProjectWithWorkOrder();
    const sha = 'a'.repeat(40);
    await insertCommit(project.id, org.id, sha, 'preview', ['WO-001']);
    const ownerCookie = await signIn(app, owner.email);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/claim`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: {},
    });
    void handle;

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/complete`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { commitSha: sha },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'commit_not_verified_by_ci' });

    await app.close();
  });

  test('POST complete succeeds with a baseline commit carrying the matching Refs: trailer', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    const sha = 'c'.repeat(40);
    await insertCommit(project.id, org.id, sha, 'baseline', ['WO-001']);
    const ownerCookie = await signIn(app, owner.email);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/claim`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/complete`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { commitSha: sha },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ status: 'done' });

    await app.close();
  });

  test('POST archive requires admin (an editor is forbidden); an admin archives with a reason and it is audit-logged', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, editorCookie),
      payload: { reason: 'superseded' },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { reason: 'superseded' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().result).toMatchObject({ id: 'WO-001', status: 'archived' });

    const { rows } = await pg.ownerPool.query(`SELECT action, target, metadata FROM audit_log WHERE project_id = $1 AND action = 'work_order.archived'`, [project.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('WO-001');
    expect(rows[0].metadata).toMatchObject({ reason: 'superseded' });

    await app.close();
  });

  test('POST archive rejects archiving a work order that is already done', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProjectWithWorkOrder();
    await pg.ownerPool.query(`UPDATE "documents" SET published_raw = REPLACE(published_raw, 'status: pending', 'status: done') WHERE project_id = $1 AND doc_id = 'WO-001'`, [project.id]);
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/work-orders/WO-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: {},
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });
});
