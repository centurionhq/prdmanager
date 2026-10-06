/**
 * Remote `create_document`/`update_document`/`publish_document` (SDD-020 "Autoria remota de documentos
 * por MCP", WO-422/423/424): the tracked expansion of the remote-authoring boundary, reusing the exact
 * same `createAndSubmitDocument`/`publishDocumentVersion` logic the session-authenticated REST routes
 * use (`documents.ts`/`documents-publish.ts`, WO-420), so this suite mirrors their own test shapes
 * (`documents.test.ts`/`documents-publish.test.ts`) but drives everything over the MCP client instead.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createCiToken, createTenantDb, upsertReportedCommits } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { buildRemoteDocumentsPort } from '../../src/documents/remote-documents-port.js';
import { resolvePgProjectEngine } from '../../src/engine/resolve-pg-project-engine.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('remote create_document / update_document / publish_document (SDD-020)', () => {
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

  async function startApp() {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j });
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    return { app, baseUrl: `http://127.0.0.1:${address.port}` };
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function mintToken(app: ReturnType<typeof buildServer>, cookie: string, orgSlug: string, name: string): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { orgSlug, name, scopes: ['mcp:read', 'mcp:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    return created.json().secret as string;
  }

  /** An owner (admin role) and an editor-role member, both with `mcp:read`/`mcp:write` tokens and a
   * `user_profile.handle` (required for `createdBy`'s `dev:<handle>` actor pattern), in a fresh
   * org+project. */
  async function setupProject(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editorUser = await seedUser(env, pg.appPool, PASSWORD);
    await pg.ownerPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, $2)`, [owner.id, `owner-${randomUUID().slice(0, 8)}`]);
    await pg.ownerPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, $2)`, [editorUser.id, `editor-${randomUUID().slice(0, 8)}`]);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editorUser.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editorUser.id, org.id]);
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const ownerCookie = await signIn(app, owner.email);
    const editorCookie = await signIn(app, editorUser.email);
    const ownerSecret = await mintToken(app, ownerCookie, org.slug, 'owner token');
    const editorSecret = await mintToken(app, editorCookie, org.slug, 'editor token');
    return { org, project, ownerId: owner.id, ownerSecret, editorSecret };
  }

  function buildClient(url: string, secret: string) {
    return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${secret}` } } });
  }

  function toolBody<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
    return JSON.parse((result.content as { text: string }[])[0]!.text) as T;
  }

  test('create_document creates a draft and immediately submits it for review, editor role is enough', async () => {
    const { app, baseUrl } = await startApp();
    const { project, editorSecret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, editorSecret));

    const result = await client.callTool({ name: 'create_document', arguments: { kind: 'ART', title: 'Customer call notes' } });
    expect(result.isError).toBeFalsy();
    const body = toolBody<{ document: { docId: string; workflowState: string; kind: string }; latestVersion: { id: string; contentHash: string } | null }>(result);
    expect(body.document.workflowState).toBe('in_review');
    expect(body.document.kind).toBe('ART');
    expect(body.latestVersion).not.toBeNull();

    await client.close();
    await app.close();
  });

  test('create_document accepts kind: BC (PRD-011/SDD-022, WO-436), saved under docs/business-case', async () => {
    const { app, baseUrl } = await startApp();
    const { project, editorSecret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, editorSecret));

    const result = await client.callTool({ name: 'create_document', arguments: { kind: 'BC', title: 'Reducir el churn de cuentas nuevas' } });
    expect(result.isError).toBeFalsy();
    const body = toolBody<{ document: { docId: string; workflowState: string; kind: string; sourcePath: string } }>(result);
    expect(body.document.kind).toBe('BC');
    expect(body.document.docId).toMatch(/^BC-\d+$/);
    expect(body.document.sourcePath).toContain('docs/business-case/');

    await client.close();
    await app.close();
  });

  test('create_document with fields/body seeds content beyond the bare template', async () => {
    const { app, baseUrl } = await startApp();
    const { project, ownerSecret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, ownerSecret));

    const result = await client.callTool({
      name: 'create_document',
      arguments: { kind: 'ART', title: 'Seeded artifact', fields: { source: 'call', root: true }, body: '## Notas\n\nContenido real.' },
    });
    expect(result.isError).toBeFalsy();
    const body = toolBody<{ document: { docId: string } }>(result);

    const { rows } = await pg.ownerPool.query(`SELECT rendered_markdown FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE d.doc_id = $1 ORDER BY dv.version_no DESC LIMIT 1`, [
      body.document.docId,
    ]);
    expect(rows[0].rendered_markdown).toContain('Contenido real.');
    expect(rows[0].rendered_markdown).toContain('source: "call"');

    await client.close();
    await app.close();
  });

  test('create_document is denied with missing_scope for a token without mcp:write', async () => {
    const { app, baseUrl } = await startApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { orgSlug: org.slug, name: 'read only', scopes: ['mcp:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));
    const result = await client.callTool({ name: 'create_document', arguments: { kind: 'ART', title: 'x' } });
    expect(result.isError).toBe(true);
    expect(toolBody<{ error: string }>(result).error).toBe('missing_scope');

    await client.close();
    await app.close();
  });

  test('update_document changes fields/body on an in_review document, preserving anything not passed', async () => {
    const { app, baseUrl } = await startApp();
    const { project, ownerSecret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, ownerSecret));

    const created = await client.callTool({ name: 'create_document', arguments: { kind: 'ART', title: 'Draft to edit' } });
    const createdBody = toolBody<{ document: { docId: string } }>(created);

    const updated = await client.callTool({ name: 'update_document', arguments: { id: createdBody.document.docId, body: 'Cuerpo actualizado.' } });
    expect(updated.isError).toBeFalsy();
    const updatedBody = toolBody<{ document: { docId: string; title: string } }>(updated);
    expect(updatedBody.document.title).toBe('Draft to edit');

    const { rows } = await pg.ownerPool.query(`SELECT rendered_markdown FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE d.doc_id = $1 ORDER BY dv.version_no DESC LIMIT 1`, [
      createdBody.document.docId,
    ]);
    expect(rows[0].rendered_markdown).toContain('Cuerpo actualizado.');

    await client.close();
    await app.close();
  });

  test('update_document rejects (via a thrown/error result) a published document', async () => {
    const { app, baseUrl } = await startApp();
    const { org, project, ownerSecret } = await setupProject(app);
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'ART-001', 'ART', 'Already published', 'docs/artifacts/ART-001.md', 'collab', 'published', $4, 'h1')`,
      [randomUUID(), org.id, project.id, '---\nid: ART-001\ntype: ART\ntitle: Already published\nsource: other\nroot: true\n---\nx\n'],
    );

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, ownerSecret));
    const result = await client.callTool({ name: 'update_document', arguments: { id: 'ART-001', body: 'y' } });
    expect(result.isError).toBe(true);

    await client.close();
    await app.close();
  });

  test('publish_document publishes an in_review document and generates work orders for an SDD', async () => {
    const { app, baseUrl } = await startApp();
    const { org, project, ownerSecret } = await setupProject(app);
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $4, 'h0')`,
      [randomUUID(), org.id, project.id, '---\nid: FR-001\ntype: FR\ntitle: "Example feature"\nstatus: approved\n---\n\n## Solicitud\n'],
    );

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, ownerSecret));

    const created = await client.callTool({
      name: 'create_document',
      arguments: {
        kind: 'SDD',
        title: 'Remote design',
        fields: { architects: ['FR-001'], impacts_paths: ['src/example.ts'] },
        body: '## Contexto\n\n## Tareas\n\n- [ ] Implement the thing',
      },
    });
    const createdBody = toolBody<{ document: { docId: string }; latestVersion: { id: string; contentHash: string } }>(created);

    const published = await client.callTool({
      name: 'publish_document',
      arguments: { id: createdBody.document.docId, version_id: createdBody.latestVersion.id, content_hash: createdBody.latestVersion.contentHash },
    });
    expect(published.isError).toBeFalsy();
    const publishedBody = toolBody<{ document: { workflowState: string }; workOrders?: { generated: boolean; created: number } }>(published);
    expect(publishedBody.document.workflowState).toBe('published');
    expect(publishedBody.workOrders).toEqual({ generated: true, created: 1 });

    await client.close();
    await app.close();
  });

  test('publish_document rejects a stale version_id/content_hash', async () => {
    const { app, baseUrl } = await startApp();
    const { project, ownerSecret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, ownerSecret));

    const created = await client.callTool({ name: 'create_document', arguments: { kind: 'ART', title: 'Stale test' } });
    const createdBody = toolBody<{ document: { docId: string } }>(created);

    const result = await client.callTool({ name: 'publish_document', arguments: { id: createdBody.document.docId, version_id: 'not-the-real-id', content_hash: 'deadbeef' } });
    expect(result.isError).toBe(true);

    await client.close();
    await app.close();
  });

  test('publish_document requires the stronger publish (admin-only) permission: an editor token is denied with insufficient_role', async () => {
    const { app, baseUrl } = await startApp();
    const { project, ownerSecret, editorSecret } = await setupProject(app);

    const ownerClient = new Client({ name: 'test-client', version: '0.0.0' });
    await ownerClient.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, ownerSecret));
    const created = await ownerClient.callTool({ name: 'create_document', arguments: { kind: 'ART', title: 'Editor cannot publish' } });
    const createdBody = toolBody<{ document: { docId: string }; latestVersion: { id: string; contentHash: string } }>(created);
    await ownerClient.close();

    const editorClient = new Client({ name: 'test-client', version: '0.0.0' });
    await editorClient.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, editorSecret));
    const result = await editorClient.callTool({
      name: 'publish_document',
      arguments: { id: createdBody.document.docId, version_id: createdBody.latestVersion.id, content_hash: createdBody.latestVersion.contentHash },
    });
    expect(result.isError).toBe(true);
    expect(toolBody<{ error: string }>(result).error).toBe('insufficient_role');

    await editorClient.close();
    await app.close();
  });

  test('get_impacts_paths_drift surfaces the SDD-016-shaped suggestion over MCP, read-only for an editor token (SDD-021, WO-431)', async () => {
    const { app, baseUrl } = await startApp();
    const { org, project, editorSecret } = await setupProject(app);

    const BLUEPRINT_ID = 'SDD-001';
    const WO_ID = 'WO-001';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, `---\nid: FR-001\ntype: FR\ntitle: "Example feature"\n---\n\n## Solicitud\n`],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', 'Example blueprint', 'docs/sdd/SDD-001.md', 'collab', 'published', $4)`,
      [org.id, project.id, BLUEPRINT_ID, `---\nid: ${BLUEPRINT_ID}\ntype: SDD\ntitle: "Example blueprint"\narchitects: ["FR-001"]\nimpacts_paths: ["packages/core/tests"]\n---\n\n## Contexto\n\n## Tareas\n\n- [ ] x\n`],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'WO', 'Do the thing', 'docs/work-orders/WO-001.md', 'generated', 'published', $4)`,
      [org.id, project.id, WO_ID, `---\nid: ${WO_ID}\ntype: WO\ntitle: "Do the thing"\nstatus: done\nimplements: ["${BLUEPRINT_ID}"]\n---\n\ntask\n`],
    );
    const { rows: ownerRows } = await pg.ownerPool.query<{ userId: string }>(`SELECT "userId" FROM "member" WHERE "organizationId" = $1 AND role = 'owner' LIMIT 1`, [org.id]);
    const token = await createCiToken(pg.appPool, { orgId: org.id, projectIds: [project.id], name: 'ci', scopes: ['reports:baseline'], expiresAt: new Date(Date.now() + DAY_MS), createdBy: ownerRows[0]!.userId });
    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId: token.record.id,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'a'.repeat(40), author: 'Alice', date: '2026-09-17T00:00:00.000Z', subject: `feat: x\n\nRefs: ${WO_ID}`, refs: [WO_ID], files: ['packages/core/tests/unit/foo.test.ts'] }],
    });

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, editorSecret));
    const result = await client.callTool({ name: 'get_impacts_paths_drift', arguments: { blueprint_id: BLUEPRINT_ID } });
    expect(result.isError).toBeFalsy();
    const body = toolBody<{ blueprintId: string; currentPatterns: string[]; suggestedAdditions: string[] }>(result);
    expect(body).toMatchObject({ blueprintId: BLUEPRINT_ID, currentPatterns: ['packages/core/tests'], suggestedAdditions: ['packages/core/tests/unit/foo.test.ts'] });

    await client.close();
    await app.close();
  });

  test('get_impacts_paths_drift returns found: false for an id that is not a blueprint', async () => {
    const { app, baseUrl } = await startApp();
    const { project, editorSecret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, editorSecret));
    const result = await client.callTool({ name: 'get_impacts_paths_drift', arguments: { blueprint_id: 'SDD-999' } });
    expect(result.isError).toBeFalsy();
    expect(toolBody<{ found: boolean }>(result)).toEqual({ found: false });

    await client.close();
    await app.close();
  });

  describe('RemoteDocumentsPort lectura (WO-628)', () => {
    async function portFor(orgId: string, projectId: string) {
      const projectRecord = await createTenantDb(pg.appPool).forOrg(orgId).projects.findById(projectId);
      const engine = resolvePgProjectEngine(pg.appPool, neo4j, orgId, projectRecord!);
      return buildRemoteDocumentsPort(pg.appPool, orgId, projectRecord!, engine);
    }

    async function seedDocument(orgId: string, projectId: string, docId: string, kind: string, workflowState: string, folder: string) {
      const content = `---\nid: "${docId}"\ntitle: "Seeded ${docId}"\n---\n\nbody\n`;
      await pg.ownerPool.query(
        `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
         VALUES ($1, $2, $3, $4, $5, $6, 'collab', $7, $8)`,
        [orgId, projectId, docId, kind, `Seeded ${docId}`, `docs/${folder}/${docId}.md`, workflowState, workflowState === 'published' ? content : null],
      );
    }

    test('list() returns every workflow state (WO included) and list({kind}) / list({workflowState}) filter in the database', async () => {
      const { app } = await startApp();
      const { org, project, ownerId } = await setupProject(app);
      const port = await portFor(org.id, project.id);

      const art = await port.createAndSubmit('ART', 'Notas de llamada', ownerId);
      await seedDocument(org.id, project.id, 'PRD-001', 'PRD', 'published', 'prd');
      await seedDocument(org.id, project.id, 'SDD-001', 'SDD', 'draft', 'sdd');
      await seedDocument(org.id, project.id, 'FB-001', 'FB', 'archived', 'feedback');
      await seedDocument(org.id, project.id, 'WO-001', 'WO', 'published', 'work-orders');

      const ids = (docs: { docId: string }[]) => docs.map((d) => d.docId).sort();
      expect(ids(await port.list())).toEqual([art.document.docId, 'FB-001', 'PRD-001', 'SDD-001', 'WO-001'].sort());
      expect(ids(await port.list({}))).toHaveLength(5);
      expect(ids(await port.list({ kind: 'PRD' }))).toEqual(['PRD-001']);
      expect(ids(await port.list({ kind: 'WO' }))).toEqual(['WO-001']);
      expect(ids(await port.list({ workflowState: 'draft' }))).toEqual(['SDD-001']);
      expect(ids(await port.list({ workflowState: 'in_review' }))).toEqual([art.document.docId]);
      expect(ids(await port.list({ workflowState: 'archived' }))).toEqual(['FB-001']);

      await app.close();
    });

    test('get() returns the full body of an unpublished (in_review) document, and null for an unknown id (FB-095)', async () => {
      const { app } = await startApp();
      const { org, project, ownerId } = await setupProject(app);
      const port = await portFor(org.id, project.id);

      const art = await port.createAndSubmit('ART', 'Notas de llamada', ownerId);
      const found = await port.get(art.document.docId);
      expect(found).not.toBeNull();
      expect(found!.document.workflowState).toBe('in_review');
      expect(found!.document.kind).toBe('ART');
      expect(found!.latestVersion!.renderedMarkdown).toContain('Notas de llamada');
      expect(found!.latestVersion!.renderedMarkdown).toContain(`id: "${art.document.docId}"`);
      // `createDraft` stores `frontmatter: {}` for version 1 (packages/db/src/documents-repository.ts:123),
      // so the empty snapshot on a freshly created document is expected, not a port bug. One save on top of
      // it is enough to prove the DTO really exposes the stored snapshot.
      await port.saveDraftVersion(art.document.docId, { fields: { source: 'call' }, createdBy: ownerId });
      const afterUpdate = await port.get(art.document.docId);
      expect(afterUpdate!.latestVersion!.frontmatter.id).toBe(art.document.docId);
      expect(found!.latestVersion!.versionNo).toBeGreaterThanOrEqual(1);
      expect(found!.latestVersion!.contentHash).not.toBe('');
      expect(await port.get('ART-999')).toBeNull();

      await app.close();
    });

    test('a docId that only exists in another project of the same org does not leak through get() or list()', async () => {
      const { app } = await startApp();
      const { org, project, ownerId } = await setupProject(app);
      const projectB = await createProjectFixture(pg, { orgId: org.id });
      const portA = await portFor(org.id, project.id);
      const portB = await portFor(org.id, projectB.id);

      const art = await portA.createAndSubmit('ART', 'Solo en A', ownerId);
      await seedDocument(org.id, projectB.id, 'PRD-777', 'PRD', 'published', 'prd');

      expect(await portA.get('PRD-777')).toBeNull();
      expect((await portA.list()).map((d) => d.docId)).not.toContain('PRD-777');
      expect(await portB.get(art.document.docId)).toBeNull();
      expect((await portB.list()).map((d) => d.docId)).toEqual(['PRD-777']);

      await app.close();
    });
  });
});
