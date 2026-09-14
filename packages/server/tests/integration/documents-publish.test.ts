/**
 * WO-137 — `POST .../documents/:docId/publish`: version/hash staleness checks, blocking
 * `validateDocument` in `'publish'` mode, server-managed `status`, a frozen `published` version and the
 * WO-133 outbox projection actually running (asserted via `graph_dirty`/`graph_version`, never timing).
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/publish (WO-137)', () => {
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

  async function setupOrgAndProject() {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    return { owner, editor, org, project };
  }

  async function createAndRequestReview(app: ReturnType<typeof buildServer>, editorCookie: string, org: { slug: string }, project: { slug: string }, kind: string, title: string) {
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { kind, title },
    });
    const docId = created.json().document.docId as string;
    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/request-review`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
    });
    const detail = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}`, headers: { ...AUTH_HOST(), cookie: editorCookie } });
    return { docId, latestVersion: detail.json().document.latestVersion as { id: string; contentHash: string } };
  }

  test('publishes an ART document (its template needs no feature link), sets status active, freezes a published version and runs the outbox projection', async () => {
    const app = buildApp();
    const { owner, editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);
    const { docId, latestVersion } = await createAndRequestReview(app, editorCookie, org, project, 'ART', 'Customer call notes');

    const before = await pg.ownerPool.query(`SELECT graph_dirty, graph_version FROM "projects" WHERE id = $1`, [project.id]).then((r) => r.rows[0]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/publish`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { versionId: latestVersion.id, contentHash: latestVersion.contentHash },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.document.workflowState).toBe('published');
    expect(body.document.publishedRaw).toContain('status: "active"');

    const after = await pg.ownerPool.query(`SELECT graph_dirty, graph_version FROM "projects" WHERE id = $1`, [project.id]).then((r) => r.rows[0]);
    expect(after.graph_dirty).toBe(false);
    expect(Number(after.graph_version)).toBeGreaterThan(Number(before.graph_version));

    const { rows } = await pg.ownerPool.query(
      `SELECT reason, content_hash FROM "document_versions" dv JOIN "documents" d ON d.id = dv.document_id WHERE d.project_id = $1 AND d.doc_id = $2 ORDER BY version_no`,
      [project.id, docId],
    );
    expect(rows.map((r: { reason: string }) => r.reason)).toEqual(['manual', 'published']);

    const { rows: auditRows } = await pg.ownerPool.query(`SELECT action FROM audit_log WHERE org_id = $1 AND action = 'document.published'`, [org.id]);
    expect(auditRows).toHaveLength(1);

    await app.close();
  });

  test('editor cannot publish (403); only admin can', async () => {
    const app = buildApp();
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const { docId, latestVersion } = await createAndRequestReview(app, editorCookie, org, project, 'ART', 'Customer call notes');

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/publish`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { versionId: latestVersion.id, contentHash: latestVersion.contentHash },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  test('rejects (409) a stale versionId/contentHash', async () => {
    const app = buildApp();
    const { owner, editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);
    const { docId } = await createAndRequestReview(app, editorCookie, org, project, 'ART', 'Customer call notes');

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/publish`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { versionId: 'not-the-real-version-id', contentHash: 'deadbeef' },
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  test('rejects (409) a document that is still a draft (never requested review)', async () => {
    const app = buildApp();
    const { owner, editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { kind: 'ART', title: 'Still a draft' },
    });
    const body = created.json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${body.document.docId}/publish`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { versionId: body.document.latestVersion.id, contentHash: body.document.latestVersion.contentHash },
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  test('blocking validateDocument issues (e.g. an unjustified Feature) refuse publish with 409', async () => {
    const app = buildApp();
    const { owner, editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);
    // PRD's template parses (schema-valid) but has no justified_by/informs -> blocking lifecycle issue.
    const { docId, latestVersion } = await createAndRequestReview(app, editorCookie, org, project, 'PRD', 'Unjustified feature');

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/publish`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { versionId: latestVersion.id, contentHash: latestVersion.contentHash },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain(docId);

    await app.close();
  });
});
