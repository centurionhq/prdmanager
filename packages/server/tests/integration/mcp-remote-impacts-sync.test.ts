/**
 * `sync_impacts_paths` over the real remote MCP endpoint (SDD-119 D1/D2/D3, WO-786): the agent applies the
 * exact suggestion `get_impacts_paths_drift` showed it, through the same `applyImpactsPathsSync` the REST
 * route uses. Admin-only, echo + mandatory reason.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createCiToken, upsertReportedCommits } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const BLUEPRINT_ID = 'SDD-001';
const WO_ID = 'WO-001';
const NEW_PATH = 'packages/core/tests/unit/foo.test.ts';
const FEATURE_TEMPLATE = `---\nid: FR-001\ntype: FR\ntitle: "Example feature"\n---\n\n## Solicitud\n`;
const BLUEPRINT_TEMPLATE = `---\nid: ${BLUEPRINT_ID}\ntype: SDD\ntitle: "Example blueprint"\narchitects: ["FR-001"]\nimpacts_paths: ["packages/core/tests"]\n---\n\n## Contexto\n\n## Tareas\n\n- [ ] x\n`;
const WO_TEMPLATE = `---\nid: ${WO_ID}\ntype: WO\ntitle: "Do the thing"\nstatus: done\nimplements: ["${BLUEPRINT_ID}"]\n---\n\ntask\n`;

describe('remote MCP sync_impacts_paths (SDD-119, WO-786)', () => {
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

  async function mintToken(app: ReturnType<typeof buildServer>, email: string, orgSlug: string, scopes: string[]): Promise<string> {
    const cookie = await signIn(app, email);
    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { orgSlug, name: 'dev token', scopes, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    return created.json().secret as string;
  }

  /** SDD-001 declares `packages/core/tests`; a baseline commit referencing its WO touched a file below it. */
  async function setupProject(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const docs: Array<[string, string, string, string, string, string]> = [
      ['FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', FEATURE_TEMPLATE],
      [BLUEPRINT_ID, 'SDD', 'Example blueprint', 'docs/sdd/SDD-001.md', 'collab', BLUEPRINT_TEMPLATE],
      [WO_ID, 'WO', 'Do the thing', 'docs/work-orders/WO-001.md', 'generated', WO_TEMPLATE],
    ];
    for (const [docId, kind, title, sourcePath, origin, raw] of docs) {
      await pg.ownerPool.query(
        `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8)`,
        [org.id, project.id, docId, kind, title, sourcePath, origin, raw],
      );
    }
    const ci = await createCiToken(pg.appPool, { orgId: org.id, projectIds: [project.id], name: 'ci', scopes: ['reports:baseline'], expiresAt: new Date(Date.now() + DAY_MS), createdBy: owner.id });
    await upsertReportedCommits(pg.appPool, {
      projectId: project.id,
      orgId: org.id,
      tokenId: ci.record.id,
      trust: 'baseline',
      branch: 'main',
      commits: [{ sha: 'a'.repeat(40), author: 'Alice', date: '2026-09-17T00:00:00.000Z', subject: `feat: x\n\nRefs: ${WO_ID}`, refs: [WO_ID], files: [NEW_PATH] }],
    });

    return { owner, editor, org, project };
  }

  async function mcpClientFor(baseUrl: string, secret: string, graphProjectId: string): Promise<Client> {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${graphProjectId}`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }));
    return client;
  }

  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as Record<string, unknown>;
    return { isError: result.isError, body };
  };

  async function publishedRaw(projectId: string): Promise<string> {
    const { rows } = await pg.ownerPool.query(`SELECT published_raw FROM "documents" WHERE project_id = $1 AND doc_id = $2`, [projectId, BLUEPRINT_ID]);
    return rows[0].published_raw;
  }

  test('tools/list includes sync_impacts_paths', async () => {
    const { app, baseUrl } = await startApp();
    const { owner, org, project } = await setupProject(app);
    const client = await mcpClientFor(baseUrl, await mintToken(app, owner.email, org.slug, ['mcp:read', 'mcp:write']), project.graphProjectId);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('sync_impacts_paths');

    await client.close();
    await app.close();
  });

  test('an admin applies the literal echo of get_impacts_paths_drift; both audit rows are written', async () => {
    const { app, baseUrl } = await startApp();
    const { owner, org, project } = await setupProject(app);
    const client = await mcpClientFor(baseUrl, await mintToken(app, owner.email, org.slug, ['mcp:read', 'mcp:write']), project.graphProjectId);

    const drift = await call(client, 'get_impacts_paths_drift', { blueprint_id: BLUEPRINT_ID });
    expect(drift.body.suggestedAdditions).toEqual([NEW_PATH]);

    const applied = await call(client, 'sync_impacts_paths', { blueprint_id: BLUEPRINT_ID, expectedSuggestion: drift.body.suggestedAdditions, reason: 'typo en el patrón' });
    expect(applied.isError).toBeFalsy();
    expect(applied.body.impactsPaths).toContain(NEW_PATH);
    expect(await publishedRaw(project.id)).toContain(NEW_PATH);

    const { rows: restAudit } = await pg.ownerPool.query(`SELECT metadata FROM audit_log WHERE org_id = $1 AND action = 'document.impacts_paths_synced'`, [org.id]);
    expect(restAudit).toHaveLength(1);
    expect(restAudit[0].metadata.reason).toBe('typo en el patrón');
    const { rows: mcpAudit } = await pg.ownerPool.query(`SELECT target FROM audit_log WHERE org_id = $1 AND action = 'mcp.sync_impacts_paths'`, [org.id]);
    expect(mcpAudit).toHaveLength(1);
    expect(mcpAudit[0].target).toBe(BLUEPRINT_ID);

    await client.close();
    await app.close();
  });

  test('a stale echo answers suggestion_changed and leaves the document untouched', async () => {
    const { app, baseUrl } = await startApp();
    const { owner, org, project } = await setupProject(app);
    const client = await mcpClientFor(baseUrl, await mintToken(app, owner.email, org.slug, ['mcp:read', 'mcp:write']), project.graphProjectId);
    const before = await publishedRaw(project.id);

    const result = await call(client, 'sync_impacts_paths', { blueprint_id: BLUEPRINT_ID, expectedSuggestion: ['some/stale/path.ts'], reason: 'x' });
    expect(result.isError).toBe(true);
    expect(result.body).toMatchObject({ error: 'suggestion_changed' });
    expect(await publishedRaw(project.id)).toBe(before);

    await client.close();
    await app.close();
  });

  test('a project editor (not admin) with mcp:write answers insufficient_role', async () => {
    const { app, baseUrl } = await startApp();
    const { editor, org, project } = await setupProject(app);
    const client = await mcpClientFor(baseUrl, await mintToken(app, editor.email, org.slug, ['mcp:read', 'mcp:write']), project.graphProjectId);
    const before = await publishedRaw(project.id);

    const result = await call(client, 'sync_impacts_paths', { blueprint_id: BLUEPRINT_ID, expectedSuggestion: [NEW_PATH], reason: 'x' });
    expect(result.isError).toBe(true);
    expect(result.body).toMatchObject({ error: 'insufficient_role' });
    expect(await publishedRaw(project.id)).toBe(before);

    await client.close();
    await app.close();
  });

  test('a token with only mcp:read answers missing_scope', async () => {
    const { app, baseUrl } = await startApp();
    const { owner, org, project } = await setupProject(app);
    const client = await mcpClientFor(baseUrl, await mintToken(app, owner.email, org.slug, ['mcp:read']), project.graphProjectId);

    const result = await call(client, 'sync_impacts_paths', { blueprint_id: BLUEPRINT_ID, expectedSuggestion: [NEW_PATH], reason: 'x' });
    expect(result.isError).toBe(true);
    expect(result.body).toMatchObject({ error: 'missing_scope' });

    await client.close();
    await app.close();
  });
});
