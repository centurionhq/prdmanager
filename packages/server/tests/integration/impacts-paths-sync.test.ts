/**
 * `GET .../documents/:docId/impacts-paths/drift` and `POST .../documents/:docId/impacts-paths/sync`
 * (SDD-021 "Reconciliacion de impacts_paths desde CI", WO-430): admin-only, optimistic-concurrency
 * application of a CI-derived `impacts_paths` suggestion to an already-published blueprint.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createCiToken, createTenantDb, upsertReportedCommits } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

const BLUEPRINT_ID = 'SDD-001';
const WO_ID = 'WO-001';
const FEATURE_TEMPLATE = `---\nid: FR-001\ntype: FR\ntitle: "Example feature"\n---\n\n## Solicitud\n`;
const BLUEPRINT_TEMPLATE = `---\nid: ${BLUEPRINT_ID}\ntype: SDD\ntitle: "Example blueprint"\narchitects: ["FR-001"]\nimpacts_paths: ["packages/core/tests"]\n---\n\n## Contexto\n\n## Tareas\n\n- [ ] x\n`;
const WO_TEMPLATE = `---\nid: ${WO_ID}\ntype: WO\ntitle: "Do the thing"\nstatus: done\nimplements: ["${BLUEPRINT_ID}"]\n---\n\ntask\n`;

describe('impacts-paths drift/sync (WO-430)', () => {
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

  async function setup() {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, FEATURE_TEMPLATE],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', 'Example blueprint', 'docs/sdd/SDD-001.md', 'collab', 'published', $4)`,
      [org.id, project.id, BLUEPRINT_ID, BLUEPRINT_TEMPLATE],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'WO', 'Do the thing', 'docs/work-orders/WO-001.md', 'generated', 'published', $4)`,
      [org.id, project.id, WO_ID, WO_TEMPLATE],
    );

    const token = await createCiToken(pg.appPool, { orgId: org.id, projectIds: [project.id], name: 'ci', scopes: ['reports:baseline'], expiresAt: new Date(Date.now() + 86_400_000), createdBy: owner.id });
    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId: token.record.id,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'a'.repeat(40), author: 'Alice', date: '2026-09-17T00:00:00.000Z', subject: `feat: x\n\nRefs: ${WO_ID}`, refs: [WO_ID], files: ['packages/core/tests/unit/foo.test.ts'] }],
    });

    return { owner, editor, org, project };
  }

  test('GET drift surfaces the SDD-016-shaped suggestion for an admin (view-gated, not sync-gated)', async () => {
    const app = buildApp();
    const { editor, org, project } = await setup();
    const editorCookie = await signIn(app, editor.email);

    const res = await app.inject({ method: 'GET', url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${BLUEPRINT_ID}/impacts-paths/drift`, headers: { ...AUTH_HOST(), cookie: editorCookie } });

    expect(res.statusCode).toBe(200);
    expect(res.json().drift).toMatchObject({ blueprintId: BLUEPRINT_ID, currentPatterns: ['packages/core/tests'], suggestedAdditions: ['packages/core/tests/unit/foo.test.ts'] });

    await app.close();
  });

  test('POST sync applies the suggestion and audits document.impacts_paths_synced', async () => {
    const app = buildApp();
    const { owner, org, project } = await setup();
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${BLUEPRINT_ID}/impacts-paths/sync`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { expectedSuggestion: ['packages/core/tests/unit/foo.test.ts'], reason: 'SDD-016-style incident, missing /** suffix' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().impactsPaths.sort()).toEqual(['packages/core/tests', 'packages/core/tests/unit/foo.test.ts'].sort());

    const { rows } = await pg.ownerPool.query(`SELECT published_raw FROM "documents" WHERE project_id = $1 AND doc_id = $2`, [project.id, BLUEPRINT_ID]);
    expect(rows[0].published_raw).toContain('packages/core/tests/unit/foo.test.ts');

    const { rows: auditRows } = await pg.ownerPool.query(`SELECT action, metadata FROM audit_log WHERE org_id = $1 AND action = 'document.impacts_paths_synced'`, [org.id]);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata.reason).toBe('SDD-016-style incident, missing /** suffix');

    await app.close();
  });

  test('POST sync rejects (409) a stale expectedSuggestion', async () => {
    const app = buildApp();
    const { owner, org, project } = await setup();
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${BLUEPRINT_ID}/impacts-paths/sync`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { expectedSuggestion: ['some/stale/path.ts'], reason: 'x' },
    });

    expect(res.statusCode).toBe(409);
    await app.close();
  });

  test('POST sync requires the sync_impacts_paths (admin-only) permission: an editor is denied with 403', async () => {
    const app = buildApp();
    const { editor, org, project } = await setup();
    const editorCookie = await signIn(app, editor.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${BLUEPRINT_ID}/impacts-paths/sync`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { expectedSuggestion: ['packages/core/tests/unit/foo.test.ts'], reason: 'x' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('POST sync rejects a whitespace-only reason with 400', async () => {
    const app = buildApp();
    const { owner, org, project } = await setup();
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${BLUEPRINT_ID}/impacts-paths/sync`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), ownerCookie),
      payload: { expectedSuggestion: ['packages/core/tests/unit/foo.test.ts'], reason: '   ' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
