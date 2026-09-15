/**
 * WO-136 — `/api/app/organizations/:orgSlug/projects/:projectSlug/documents/*`: create from
 * `templateFor(kind)`, list/get, request-review and archive, all gated by SDD-006's permission matrix
 * and SDD-007's archive-link rule.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('/api/app/organizations/:orgSlug/projects/:projectSlug/documents/* (WO-136)', () => {
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

  async function setupOrgAndProject() {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: viewer.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    return { owner, editor, viewer, org, project };
  }

  test('editor creates a document from a template; viewer is forbidden', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, viewer, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const viewerCookie = await signIn(app, viewer.email);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, viewerCookie),
      payload: { kind: 'PRD', title: 'My new feature' },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { kind: 'PRD', title: 'My new feature' },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json();
    expect(body.document.docId).toBe('PRD-001');
    expect(body.document.kind).toBe('PRD');
    expect(body.document.workflowState).toBe('draft');
    expect(body.document.origin).toBe('collab');
    expect(body.document.sourcePath).toBe('docs/prd/PRD-001-my-new-feature.md');
    expect(body.document.latestVersion.versionNo).toBe(1);
    expect(body.document.latestVersion.renderedMarkdown).toContain('id: "PRD-001"');
    expect(body.document.latestVersion.renderedMarkdown).toContain('title: "My new feature"');

    await app.close();
  });

  test('WO cannot be created from a template (only the generator creates work orders)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { kind: 'WO', title: 'Should not work' },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('list filters by kind/workflowState; viewer can list and get but not mutate', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, viewer, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const viewerCookie = await signIn(app, viewer.email);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { kind: 'PRD', title: 'Feature A' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { kind: 'SDD', title: 'Design A' },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents?kind=PRD`,
      headers: { ...AUTH_HOST, cookie: viewerCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().documents).toHaveLength(1);
    expect(list.json().documents[0].docId).toBe('PRD-001');

    const get = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/SDD-001`,
      headers: { ...AUTH_HOST, cookie: viewerCookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().document.docId).toBe('SDD-001');

    const notFound = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/SDD-999`,
      headers: { ...AUTH_HOST, cookie: viewerCookie },
    });
    expect(notFound.statusCode).toBe(404);

    await app.close();
  });

  test('request-review moves draft -> in_review; only works once; forbidden for viewer', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, viewer, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const viewerCookie = await signIn(app, viewer.email);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { kind: 'PRD', title: 'Feature A' },
    });

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/request-review`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, viewerCookie),
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/request-review`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().document.workflowState).toBe('in_review');

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/request-review`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
    });
    expect(conflict.statusCode).toBe(409);

    const { rows } = await pg.ownerPool.query(`SELECT action FROM audit_log WHERE org_id = $1 AND action = 'document.review_requested'`, [org.id]);
    expect(rows).toHaveLength(1);

    await app.close();
  });

  test('archive: admin-only, refuses (409) while another published document still links to it', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { owner, editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);

    // A published Feature (PRD-001) and a published Blueprint (SDD-001) that architects it, seeded
    // directly since publishing itself is WO-137's job, not this one's.
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'PRD-001', 'PRD', 'Feature A', 'docs/prd/PRD-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, '---\nid: PRD-001\ntype: PRD\ntitle: "Feature A"\nstatus: approved\n---\n\n## Resumen\n'],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'SDD-001', 'SDD', 'Design A', 'docs/sdd/SDD-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, '---\nid: SDD-001\ntype: SDD\ntitle: "Design A"\narchitects: ["PRD-001"]\nimpacts_paths: ["src/a.ts"]\n---\n\n## Tareas\n- [ ] Do it\n'],
    );

    const editorForbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
    });
    expect(editorForbidden.statusCode).toBe(403);

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toContain('SDD-001');

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/SDD-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().document.workflowState).toBe('archived');

    const nowUnblocked = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
    });
    expect(nowUnblocked.statusCode).toBe(200);

    const stillArchived = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents?workflowState=archived`,
      headers: { ...AUTH_HOST, cookie: ownerCookie },
    });
    expect(stillArchived.json().documents.map((d: { docId: string }) => d.docId).sort()).toEqual(['PRD-001', 'SDD-001']);

    await app.close();
  });

  test('archive refuses (409) a document that is not published', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, owner, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { kind: 'PRD', title: 'Still a draft' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/archive`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, ownerCookie),
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });
});
