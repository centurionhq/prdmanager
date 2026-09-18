/**
 * WO-143 — `GET .../documents/:docId/closure-readiness` and `POST .../documents/:docId/close`: the SaaS
 * replacement for the local, CLI-only `prdm close` (ADR-002 D15).
 */
import { Neo4jGraphDatabase, parseDocument } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/{closure-readiness,close} (WO-143)', () => {
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

  /** A fully lifecycle-clean project (`project_clean` requires zero project-wide error issues): an
   * approved, justified Feature architected by a well-formed Blueprint with one done, current Work
   * Order implementing it. */
  async function seedReadyFeature(orgId: string, projectId: string): Promise<void> {
    const artifactContent = '---\nid: ART-001\ntype: ART\ntitle: "Customer call"\nsource: call\nroot: true\n---\n\n## Contexto\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'ART-001', 'ART', 'Customer call', 'docs/artifacts/ART-001.md', 'collab', 'published', $3)`,
      [orgId, projectId, artifactContent],
    );
    const businessCaseContent =
      '---\nid: BC-001\ntype: BC\ntitle: "Business case"\nstatus: approved\njustified_by: ["ART-001"]\n---\n\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'BC-001', 'BC', 'Business case', 'docs/business-case/BC-001.md', 'collab', 'published', $3)`,
      [orgId, projectId, businessCaseContent],
    );
    const featureContent = '---\nid: PRD-001\ntype: PRD\ntitle: "Example feature"\nstatus: approved\njustified_by: ["BC-001"]\n---\n\n## Resumen\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'PRD-001', 'PRD', 'Example feature', 'docs/prd/PRD-001.md', 'collab', 'published', $3)`,
      [orgId, projectId, featureContent],
    );
    const blueprintContent = '---\nid: SDD-001\ntype: SDD\ntitle: "Example design"\nstatus: active\narchitects: ["PRD-001"]\nimpacts_paths: ["src/a.ts"]\n---\n\n## Tareas\n\n- [x] Do it\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'SDD-001', 'SDD', 'Example design', 'docs/sdd/SDD-001.md', 'collab', 'published', $3)`,
      [orgId, projectId, blueprintContent],
    );
    const parsedBlueprint = parseDocument(blueprintContent, 'docs/sdd/SDD-001.md');
    if (!parsedBlueprint?.ok) throw new Error('fixture blueprint failed to parse');
    const blueprintHash = parsedBlueprint.doc.node.contentHash;

    const woContent = `---\nid: WO-001\ntype: WO\ntitle: "Do it"\nstatus: done\nimplements: ["SDD-001"]\nblueprint_hashes: {"SDD-001": "${blueprintHash}"}\nsource_task: "abc1234567890def"\n---\n\nDo it.\n`;
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'WO-001', 'WO', 'Do it', 'docs/work-orders/WO-001.md', 'generated', 'published', $3)`,
      [orgId, projectId, woContent],
    );
  }

  async function setup() {
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
    return { app, owner, editor, org, project };
  }

  test('closure-readiness reports ready:true for a fully clean feature', async () => {
    const { app, owner, org, project } = await setup();
    await seedReadyFeature(org.id, project.id);
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/closure-readiness`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().readiness.ready).toBe(true);

    await app.close();
  });

  test('closure-readiness reports ready:false with a clear reason for an unapproved feature', async () => {
    const { app, owner, org, project } = await setup();
    const draftContent = '---\nid: PRD-002\ntype: PRD\ntitle: "Not ready"\nstatus: draft\n---\n\n## Resumen\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'PRD-002', 'PRD', 'Not ready', 'docs/prd/PRD-002.md', 'collab', 'published', $3)`,
      [org.id, project.id, draftContent],
    );
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-002/closure-readiness`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().readiness.ready).toBe(false);
    expect(res.json().readiness.checks.find((c: { name: string }) => c.name === 'feature_approved').ok).toBe(false);

    await app.close();
  });

  test('an editor is forbidden from closing; an admin can, and the write reaches published_raw immediately', async () => {
    const { app, editor, owner, org, project } = await setup();
    await seedReadyFeature(org.id, project.id);
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.result.featureId).toBe('PRD-001');
    expect(body.result.closedBy).toMatch(/^dev:/);
    expect(body.pendingEditablePatch).toBeUndefined();

    const { rows } = await pg.ownerPool.query(`SELECT published_raw, pending_editable_patch FROM "documents" WHERE project_id = $1 AND doc_id = 'PRD-001'`, [project.id]);
    // WO-250: `status`/`closed_at`/`closed_by` are server-managed fields — written straight to
    // `published_raw` the instant this request's transaction commits, with no `pending_editable_patch`
    // queue and no dependency on anyone ever opening PRD-001's collab editor.
    expect(rows[0].published_raw).toContain('status: "closed"');
    expect(rows[0].published_raw).toContain(`closed_at: ${JSON.stringify(body.result.closedAt)}`);
    expect(rows[0].published_raw).toContain(`closed_by: ${JSON.stringify(body.result.closedBy)}`);
    expect(rows[0].pending_editable_patch).toBeNull();

    // Visible to scan()/drift/graph/MCP immediately — the literal regression WO-250 fixes — asserted here
    // via the same closure-readiness read path the app itself uses right after closing.
    const readinessAfter = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/closure-readiness`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(readinessAfter.json().readiness.checks.find((c: { name: string }) => c.name === 'feature_approved').ok).toBe(true);

    const { rows: auditRows } = await pg.ownerPool.query(`SELECT action, target FROM audit_log WHERE org_id = $1 AND action = 'feature.closed'`, [org.id]);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].target).toBe('PRD-001');

    await app.close();
  });

  test("closing a Feature that already has live collab history also applies the status flip to its live Y.Doc, attributed to 'system' (never anonymous, never the closing user's own client)", async () => {
    const { app, owner, org, project } = await setup();
    await seedReadyFeature(org.id, project.id);
    const ownerCookie = await signIn(app, owner.email);

    const { rows: docRows } = await pg.ownerPool.query(`SELECT id FROM "documents" WHERE project_id = $1 AND doc_id = 'PRD-001'`, [project.id]);
    const documentId: string = docRows[0].id;

    // Gives PRD-001 real live collab history (as if a human had opened its editor before) — mirrors
    // `documents-restore.test.ts`'s own `seedLiveEdit` helper, without needing a real websocket connection.
    const shared = new Y.Doc({ gc: false });
    const before = Y.encodeStateVector(shared);
    shared.getMap('fm').set('title', 'Example feature');
    const seedUpdate = Buffer.from(Y.encodeStateAsUpdate(shared, before));
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { structRanges, deleteRanges } = decodeUpdateRanges(seedUpdate);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, user_id, struct_ranges, delete_ranges, update)
       VALUES ($1, $2, 1, 'user', $3, $4, $5, $6)`,
      [org.id, documentId, owner.id, JSON.stringify(structRanges), JSON.stringify(deleteRanges), seedUpdate],
    );

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-001/close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();

    const { reconstructLiveYDoc } = await import('../../src/collab/reconstruct-ydoc.js');
    const { ydoc } = await reconstructLiveYDoc(pg.appPool, org.id, documentId);
    expect(ydoc.getMap('fm').get('status')).toBe('closed');
    expect(ydoc.getMap('fm').get('closed_by')).toBe(body.result.closedBy);

    const { rows: updateRows } = await pg.ownerPool.query(`SELECT actor_kind, user_id, agent_id, on_behalf_of FROM doc_updates WHERE document_id = $1 ORDER BY seq DESC LIMIT 1`, [documentId]);
    expect(updateRows[0].actor_kind).toBe('system');
    expect(updateRows[0].user_id).toBeNull();
    expect(updateRows[0].agent_id).toBeNull();
    expect(updateRows[0].on_behalf_of).toBeNull();

    await app.close();
  });

  test('closing an unready feature is rejected with a clear 409', async () => {
    const { app, owner, org, project } = await setup();
    const draftContent = '---\nid: PRD-002\ntype: PRD\ntitle: "Not ready"\nstatus: draft\n---\n\n## Resumen\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'PRD-002', 'PRD', 'Not ready', 'docs/prd/PRD-002.md', 'collab', 'published', $3)`,
      [org.id, project.id, draftContent],
    );
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-002/close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  /** approved but with no justification at all -- project_clean fails project-wide (lifecycle_violation),
   * every other check passes. */
  async function seedProjectCleanFailingFeature(orgId: string, projectId: string): Promise<void> {
    const featureContent = '---\nid: PRD-003\ntype: PRD\ntitle: "No justification"\nstatus: approved\n---\n\n## Resumen\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'PRD-003', 'PRD', 'No justification', 'docs/prd/PRD-003.md', 'collab', 'published', $3)`,
      [orgId, projectId, featureContent],
    );
  }

  test('an editor is forbidden from force-closing; an admin force-closes with project_clean bypassed, writes close_reason/closed_forced directly, and audit-logs the full bypassed detail', async () => {
    const { app, editor, owner, org, project } = await setup();
    await seedProjectCleanFailingFeature(org.id, project.id);
    const editorCookie = await signIn(app, editor.email);
    const ownerCookie = await signIn(app, owner.email);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-003/force-close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { reason: 'known issue, closing anyway', bypass: ['project_clean'] },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-003/force-close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { reason: 'known issue, closing anyway', bypass: ['project_clean'] },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.result.featureId).toBe('PRD-003');
    expect(body.result.bypassed).toEqual([expect.objectContaining({ name: 'project_clean' })]);

    const { rows } = await pg.ownerPool.query(`SELECT published_raw, pending_editable_patch FROM "documents" WHERE project_id = $1 AND doc_id = 'PRD-003'`, [project.id]);
    expect(rows[0].published_raw).toContain('status: "closed"');
    expect(rows[0].published_raw).toContain('close_reason: "known issue, closing anyway"');
    expect(rows[0].published_raw).toContain('closed_forced: true');
    expect(rows[0].pending_editable_patch).toBeNull();

    const { rows: auditRows } = await pg.ownerPool.query(`SELECT action, target, metadata FROM audit_log WHERE org_id = $1 AND action = 'feature.force_closed'`, [org.id]);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].target).toBe('PRD-003');
    expect(auditRows[0].metadata).toMatchObject({ reason: 'known issue, closing anyway' });
    expect(auditRows[0].metadata.bypassedChecks).toEqual([expect.objectContaining({ name: 'project_clean' })]);

    await app.close();
  });

  test('force-close still 409s when feature_approved fails, even if bypass names every allowed check', async () => {
    const { app, owner, org, project } = await setup();
    const draftContent = '---\nid: PRD-004\ntype: PRD\ntitle: "Draft"\nstatus: draft\n---\n\n## Resumen\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'PRD-004', 'PRD', 'Draft', 'docs/prd/PRD-004.md', 'collab', 'published', $3)`,
      [org.id, project.id, draftContent],
    );
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-004/force-close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { reason: 'trying anyway', bypass: ['blueprints_have_work_orders', 'work_orders_done', 'project_clean'] },
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  test('force-close rejects a missing reason or an empty bypass with 400', async () => {
    const { app, owner, org, project } = await setup();
    await seedProjectCleanFailingFeature(org.id, project.id);
    const ownerCookie = await signIn(app, owner.email);

    const missingReason = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-003/force-close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { bypass: ['project_clean'] },
    });
    expect(missingReason.statusCode).toBe(400);

    const emptyBypass = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/PRD-003/force-close`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { reason: 'x', bypass: [] },
    });
    expect(emptyBypass.statusCode).toBe(400);

    await app.close();
  });
});
