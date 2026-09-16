/**
 * Remote `claim_work_order`/`complete_work_order`/`generate_work_orders` (SDD-010 "MCP remoto", WO-186;
 * `generate_work_orders` added post-migration once this repository's own dogfooding found the dashboard
 * the only place to turn a blueprint's checklist into claimable Work Orders, leaving a developer's code
 * assistant with no way to do so at all for a project with no local/stdio project left): `assignee`
 * bound to the calling token's own handle, `commit_sha` mandatory and verified against a
 * CI-baseline-trusted commit, and `generate_work_orders` converting a blueprint's unconverted checklist
 * items into pending WO-xxx documents exactly like the local/stdio profile's own tool.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('remote claim_work_order / complete_work_order (WO-186)', () => {
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

  /** A real signed-up owner (via `seedUser`) plus a known `user_profile.handle`, an org, a project with
   * a published SDD blueprint and a WO-001 document, and an `mcp:read`/`mcp:write` personal token. */
  async function setupProjectWithWorkOrder(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const handle = `dev-${randomUUID().slice(0, 8)}`;
    await pg.ownerPool.query(`INSERT INTO "user_profile" (user_id, handle) VALUES ($1, $2)`, [owner.id, handle]);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const blueprintId = randomUUID();
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'SDD-001', 'SDD', 'Design', 'docs/blueprints/SDD-001.md', 'generated', 'published', $4, 'h1')`,
      [blueprintId, org.id, project.id, '---\nid: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/**"]\n---\n## Tareas\n- [ ] x\n'],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'WO-001', 'WO', 'Task', 'docs/work-orders/WO-001.md', 'generated', 'published', $4, 'h2')`,
      [randomUUID(), org.id, project.id, '---\nid: WO-001\ntype: WO\ntitle: Task\nstatus: pending\nimplements: [SDD-001]\n---\ntask\n'],
    );

    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { orgSlug: org.slug, name: 'dev token', scopes: ['mcp:read', 'mcp:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;
    return { org, project, secret, handle, ownerId: owner.id };
  }

  function buildClient(url: string, secret: string) {
    return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${secret}` } } });
  }

  async function insertCommit(projectId: string, orgId: string, sha: string, trust: 'baseline' | 'preview', refs: string[]) {
    await pg.ownerPool.query(
      `INSERT INTO "commits" (project_id, org_id, sha, trust, author, date, subject, refs) VALUES ($1, $2, $3, $4, 'Alice', now(), 'x', $5)`,
      [projectId, orgId, sha, trust, refs],
    );
  }

  test('claim_work_order accepts dev:<own handle> and agent:<name>, but rejects claiming as someone else', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret, handle } = await setupProjectWithWorkOrder(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));

    const forbidden = await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: 'dev:someone-else' } });
    expect(forbidden.isError).toBe(true);
    const forbiddenBody = JSON.parse((forbidden.content as { text: string }[])[0]!.text) as { error: string };
    expect(forbiddenBody.error).toBe('assignee_not_self');

    const ok = await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: `dev:${handle}` } });
    expect(ok.isError).toBeFalsy();

    await client.close();
    await app.close();
  });

  test('claim_work_order accepts an agent:<name> actor for anyone', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProjectWithWorkOrder(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));
    const result = await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: 'agent:claude' } });
    expect(result.isError).toBeFalsy();

    await client.close();
    await app.close();
  });

  test('complete_work_order requires commit_sha and rejects a preview-trust commit with commit_not_verified_by_ci', async () => {
    const { app, baseUrl } = await startApp();
    const { project, org, secret, handle } = await setupProjectWithWorkOrder(app);
    const sha = 'a'.repeat(40);
    await insertCommit(project.id, org.id, sha, 'preview', ['WO-001']);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));
    await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: `dev:${handle}` } });

    const result = await client.callTool({ name: 'complete_work_order', arguments: { id: 'WO-001', commit_sha: sha } });
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as { error: string };
    expect(body.error).toBe('commit_not_verified_by_ci');

    await client.close();
    await app.close();
  });

  test('complete_work_order rejects a baseline commit missing the right Refs: trailer', async () => {
    const { app, baseUrl } = await startApp();
    const { project, org, secret, handle } = await setupProjectWithWorkOrder(app);
    const sha = 'b'.repeat(40);
    await insertCommit(project.id, org.id, sha, 'baseline', ['WO-999']);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));
    await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: `dev:${handle}` } });

    const result = await client.callTool({ name: 'complete_work_order', arguments: { id: 'WO-001', commit_sha: sha } });
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as { error: string };
    expect(body.error).toBe('commit_not_verified_by_ci');

    await client.close();
    await app.close();
  });

  test('complete_work_order succeeds with a baseline commit carrying the matching Refs: trailer', async () => {
    const { app, baseUrl } = await startApp();
    const { project, org, secret, handle } = await setupProjectWithWorkOrder(app);
    const sha = 'c'.repeat(40);
    await insertCommit(project.id, org.id, sha, 'baseline', ['WO-001']);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));
    await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: `dev:${handle}` } });

    const result = await client.callTool({ name: 'complete_work_order', arguments: { id: 'WO-001', commit_sha: sha } });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as { status: string };
    expect(body.status).toBe('done');

    await client.close();
    await app.close();
  });

  test('generate_work_orders converts SDD-001\'s unconverted checklist item into a new pending WO', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProjectWithWorkOrder(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));

    const result = await client.callTool({ name: 'generate_work_orders', arguments: { blueprint_id: 'SDD-001' } });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as { created: { id: string; status: string }[] };
    expect(body.created).toHaveLength(1);
    expect(body.created[0]?.status).toBe('pending');

    const listed = await client.callTool({ name: 'list_work_orders', arguments: { blueprint_id: 'SDD-001' } });
    const listedBody = JSON.parse((listed.content as { text: string }[])[0]!.text) as { results: { id: string }[] };
    expect(listedBody.results.map((r) => r.id)).toContain(body.created[0]?.id);

    await client.close();
    await app.close();
  });

  test('add_blueprint_task appends a task, then generate_work_orders turns it into a claimable WO', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProjectWithWorkOrder(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClient(`${baseUrl}/mcp/${project.graphProjectId}`, secret));

    const added = await client.callTool({ name: 'add_blueprint_task', arguments: { blueprint_id: 'SDD-001', task: 'Nueva tarea remota' } });
    expect(added.isError).toBeFalsy();
    const addedBody = JSON.parse((added.content as { text: string }[])[0]!.text) as { blueprint_id: string; task: string };
    expect(addedBody).toEqual({ blueprint_id: 'SDD-001', task: 'Nueva tarea remota' });

    const generated = await client.callTool({ name: 'generate_work_orders', arguments: { blueprint_id: 'SDD-001' } });
    const generatedBody = JSON.parse((generated.content as { text: string }[])[0]!.text) as { created: { id: string; title: string }[] };
    expect(generatedBody.created.map((c) => c.title)).toContain('Nueva tarea remota');

    await client.close();
    await app.close();
  });

  test('add_blueprint_task is denied with missing_scope for a token without mcp:write', async () => {
    const { app, baseUrl } = await startApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'SDD-001', 'SDD', 'Design', 'docs/blueprints/SDD-001.md', 'generated', 'published', $4, 'h1')`,
      [randomUUID(), org.id, project.id, '---\nid: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/**"]\n---\n## Tareas\n- [ ] x\n'],
    );
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
    const result = await client.callTool({ name: 'add_blueprint_task', arguments: { blueprint_id: 'SDD-001', task: 'x' } });
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as { error: string };
    expect(body.error).toBe('missing_scope');

    await client.close();
    await app.close();
  });

  test('generate_work_orders is denied with missing_scope for a token without mcp:write', async () => {
    const { app, baseUrl } = await startApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'SDD-001', 'SDD', 'Design', 'docs/blueprints/SDD-001.md', 'generated', 'published', $4, 'h1')`,
      [randomUUID(), org.id, project.id, '---\nid: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/**"]\n---\n## Tareas\n- [ ] x\n'],
    );
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
    const result = await client.callTool({ name: 'generate_work_orders', arguments: { blueprint_id: 'SDD-001' } });
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as { error: string };
    expect(body.error).toBe('missing_scope');

    await client.close();
    await app.close();
  });
});
