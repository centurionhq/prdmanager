/**
 * WO-142 — `/api/app/organizations/:orgSlug/projects/:projectSlug/graph/*` and `.../drift`: read-only
 * endpoints over the published graph, visible to any project member.
 */
import { Neo4jGraphDatabase, sha256 } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('/api/app/organizations/:orgSlug/projects/:projectSlug/graph/* and .../drift (WO-142)', () => {
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

  async function setupPublishedFeature(): Promise<{ viewerCookie: string; ownerCookie: string; org: { slug: string }; project: { slug: string; id: string } }> {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: viewer.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const content = '---\nid: PRD-001\ntype: PRD\ntitle: "Example feature"\nstatus: approved\n---\n\n## Resumen\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, 'PRD-001', 'PRD', 'Example feature', 'docs/prd/PRD-001.md', 'collab', 'published', $3, $4)`,
      [org.id, project.id, content, sha256(content)],
    );
    // Bumps graph_version/graph_dirty directly (no engine write happened) so the drift/recover-driven
    // projection actually runs and this document lands in Neo4j for the graph endpoints to read back.
    await pg.ownerPool.query(`UPDATE "projects" SET graph_dirty = true, graph_version = graph_version + 1 WHERE id = $1`, [project.id]);

    const ownerCookie = await signIn(app, owner.email);
    // Any authenticated call resolves a PgProjectEngine, and recover() (called by every read path per
    // SDD-007) re-projects a dirty graph — hitting drift once is enough to make the write visible.
    await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift`, headers: { ...AUTH_HOST(), cookie: ownerCookie } });
    // `inspect()` never re-projects on its own (drift only reads); force it via a real recover()-driving
    // write path instead: acknowledging is idempotent and safe, and its transaction() always projects.
    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/acknowledge`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { target: 'all' },
    });

    const viewerCookie = await signIn(app, viewer.email);
    return { viewerCookie, ownerCookie, org, project };
  }

  test('a viewer can read the full graph, tree, a node, work orders and drift', async () => {
    const app = buildApp();
    const { viewerCookie, org, project } = await setupPublishedFeature();

    const full = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/graph/full`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(full.statusCode).toBe(200);
    expect(full.json().nodes.some((n: { ref: string }) => n.ref === 'PRD-001')).toBe(true);

    const tree = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/graph/tree`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(tree.statusCode).toBe(200);
    expect(Array.isArray(tree.json().forest)).toBe(true);

    const node = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/graph/node/PRD-001`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(node.statusCode).toBe(200);
    expect(node.json().node.id).toBe('PRD-001');

    const missingNode = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/graph/node/PRD-999`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(missingNode.statusCode).toBe(404);

    const workOrders = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/graph/work-orders`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(workOrders.statusCode).toBe(200);
    expect(workOrders.json()).toMatchObject({ total: expect.any(Number), items: expect.any(Array), statusCounts: expect.objectContaining({ all: expect.any(Number) }) });
    expect(workOrders.json().items).toHaveLength(workOrders.json().total);

    const badActor = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/graph/work-orders?actorKind=bogus`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(badActor.statusCode).toBe(400);
    const badLimit = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/graph/work-orders?limit=0`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(badLimit.statusCode).toBe(400);

    const drift = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    expect(drift.statusCode).toBe(200);
    expect(drift.json().documents).toBe(1);

    await app.close();
  });

  test('drift never writes a baseline (inspect only, never refresh)', async () => {
    const app = buildApp();
    const { viewerCookie, org, project } = await setupPublishedFeature();
    // acknowledge("all") in setup already wrote one baseline row; capture it before hitting /drift.
    const before = await pg.ownerPool.query(`SELECT updated_at FROM "project_baselines" WHERE project_id = $1`, [project.id]);
    expect(before.rows).toHaveLength(1);

    await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });
    await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift`, headers: { ...AUTH_HOST(), cookie: viewerCookie } });

    const after = await pg.ownerPool.query(`SELECT updated_at FROM "project_baselines" WHERE project_id = $1`, [project.id]);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);

    await app.close();
  });
});
