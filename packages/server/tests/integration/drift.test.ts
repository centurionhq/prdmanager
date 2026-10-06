/**
 * WO-140 — `POST .../drift/acknowledge`: admin-only, calls `PgProjectEngine.acknowledge`, audits.
 */
import { Neo4jGraphDatabase, sha256 } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('/api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge (WO-140)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const ORIGIN = () => env.publicUrl;
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

  test('rejects a malformed target (400)', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/acknowledge`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { target: '; drop table documents;' },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('editor is forbidden; admin acknowledges "all" and it is audited', async () => {
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

    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/acknowledge`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { target: 'all' },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/acknowledge`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { target: 'all' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().report.documents).toBe(0);

    const { rows } = await pg.ownerPool.query(`SELECT action, target FROM audit_log WHERE org_id = $1 AND action = 'drift.acknowledged'`, [org.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('all');

    const { rows: baselineRows } = await pg.ownerPool.query(`SELECT baseline FROM "project_baselines" WHERE project_id = $1`, [project.id]);
    expect(baselineRows).toHaveLength(1);

    await app.close();
  });

  test('acknowledging a specific out-of-sync work order clears it', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    const ownerCookie = await signIn(app, owner.email);

    const featureContent = '---\nid: FR-001\ntype: FR\ntitle: "Example feature"\n---\n\n## Solicitud\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, featureContent],
    );
    const blueprintV1 = '---\nid: SDD-001\ntype: SDD\ntitle: "Example design"\narchitects: ["FR-001"]\nimpacts_paths: ["src/a.ts"]\n---\n\n## Tareas\n\n- [ ] Do it\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'SDD-001', 'SDD', 'Example design', 'docs/sdd/SDD-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, blueprintV1],
    );
    const woContent = `---\nid: WO-001\ntype: WO\ntitle: "Do it"\nstatus: done\nimplements: ["SDD-001"]\nblueprint_hashes: {"SDD-001": "${sha256('placeholder')}"}\n---\n\nDo it.\n`;
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'WO-001', 'WO', 'Do it', 'docs/work-orders/WO-001.md', 'generated', 'published', $3)`,
      [org.id, project.id, woContent],
    );

    // The blueprint changes after WO-001 recorded its hash -> WO-001 goes out_of_sync on refresh.
    const blueprintV2 = '---\nid: SDD-001\ntype: SDD\ntitle: "Example design"\narchitects: ["FR-001"]\nimpacts_paths: ["src/a.ts"]\n---\n\n## Contexto\n\nRevised.\n\n## Tareas\n\n- [ ] Do it\n';
    await pg.ownerPool.query(`UPDATE "documents" SET published_raw = $1 WHERE project_id = $2 AND doc_id = 'SDD-001'`, [blueprintV2, project.id]);

    const dirty = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/acknowledge`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { target: 'WO-001' },
    });
    expect(dirty.statusCode).toBe(200);
    expect(dirty.json().report.issues.some((i: { kind: string; nodeId: string }) => i.kind === 'work_order_out_of_sync' && i.nodeId === 'WO-001')).toBe(false);

    await app.close();
  });
});

describe('POST /api/v1/projects/:graphProjectId/drift/acknowledge (SDD-087 WO-B)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const ORIGIN = () => env.publicUrl;
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

  async function seedProjectWithCiToken(app: ReturnType<typeof buildServer>, scopes: string[]) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { name: 'ci-pipeline', scopes, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    return { org, project, secret: created.json().secret as string };
  }

  function ack(app: ReturnType<typeof buildServer>, graphProjectId: string, secret: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/projects/${graphProjectId}/drift/acknowledge`,
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
  }

  async function auditRows(orgId: string) {
    const { rows } = await pg.ownerPool.query(
      `SELECT actor_type, actor_id, target, metadata->>'remainingIssues' AS remaining, metadata->>'reason' AS reason FROM audit_log WHERE org_id = $1 AND action = 'drift.acknowledged'`,
      [orgId],
    );
    return rows;
  }

  test('a reports:baseline CI token acknowledges "all" and it is audited as a token actor', async () => {
    const app = buildApp();
    const { org, project, secret } = await seedProjectWithCiToken(app, ['reports:baseline']);

    const res = await ack(app, project.graphProjectId, secret, { target: 'all', reason: 'reviewed the drift, baseline is correct' });
    expect(res.statusCode).toBe(200);
    expect(res.json().report.documents).toBe(0);

    const { rows: tokenRows } = await pg.ownerPool.query(`SELECT id FROM api_tokens WHERE org_id = $1`, [org.id]);
    const rows = await auditRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_type).toBe('token');
    expect(rows[0].actor_id).toBe(tokenRows[0].id);
    expect(rows[0].target).toBe('all');
    expect(rows[0].remaining).toBe('0');
    expect(rows[0].reason).toBe('reviewed the drift, baseline is correct');

    await app.close();
  });

  test('rejects a body without reason (400) and writes no audit row', async () => {
    const app = buildApp();
    const { org, project, secret } = await seedProjectWithCiToken(app, ['reports:baseline']);

    const res = await ack(app, project.graphProjectId, secret, { target: 'all' });
    expect(res.statusCode).toBe(400);
    expect(await auditRows(org.id)).toHaveLength(0);

    await app.close();
  });

  test('a CI token with reports:write but not reports:baseline is forbidden (403)', async () => {
    const app = buildApp();
    const { project, secret } = await seedProjectWithCiToken(app, ['reports:write']);

    const res = await ack(app, project.graphProjectId, secret, { target: 'all', reason: 'nope' });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  test("another org's CI token cannot reach this project (404)", async () => {
    const app = buildApp();
    const { project } = await seedProjectWithCiToken(app, ['reports:baseline']);
    const other = await seedProjectWithCiToken(app, ['reports:baseline']);

    const res = await ack(app, project.graphProjectId, other.secret, { target: 'all', reason: 'probe' });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
