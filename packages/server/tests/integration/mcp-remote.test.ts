/**
 * `POST /mcp/:graphProjectId` and `POST /mcp` (SDD-010 "MCP remoto", WO-184): a real
 * `StreamableHTTPClientTransport` client against a listening Fastify server — scopes, tool allow-list,
 * GET/DELETE 405, CI tokens rejected, Origin allowlist, `project_ids`-scoped tokens.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { DEFAULT_MCP_TOOL_RATE_LIMIT_PER_MINUTE } from '../../src/api/mcp-remote.js';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('remote MCP endpoint (SDD-010, WO-184)', () => {
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
    env = buildTestServerEnv({ neo4j: config.neo4j, trustedOrigins: ['https://app.example.test', 'https://trusted.example.test'] });
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

  async function setupProject(app: ReturnType<typeof buildServer>, scopes: string[] = ['mcp:read', 'mcp:write']) {
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
      payload: { orgSlug: org.slug, name: 'dev token', scopes, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;
    return { org, project, secret };
  }

  function buildClientTransport(url: string, secret: string, extraHeaders: Record<string, string> = {}) {
    return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${secret}`, ...extraHeaders } } });
  }

  test('lists exactly the remote allow-list and never an authoring/mutation tool', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(`${baseUrl}/mcp/${project.graphProjectId}`, secret));

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_project',
        'get_node',
        'list_work_orders',
        'claim_work_order',
        'complete_work_order',
        'submit_feedback',
        'generate_work_orders',
        'add_blueprint_task',
      ]),
    );
    for (const forbidden of ['draft_artifact', 'commit_artifact', 'acknowledge_sync', 'refresh_index', 'create_feature_request', 'attach_artifact']) {
      expect(names).not.toContain(forbidden);
    }

    await client.close();
    await app.close();
  });

  test('a read tool call succeeds; GET and DELETE answer 405', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProject(app);
    const url = `${baseUrl}/mcp/${project.graphProjectId}`;

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(url, secret));
    const result = await client.callTool({ name: 'list_work_orders', arguments: {} });
    expect(result.isError).toBeFalsy();
    await client.close();

    const getRes = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${secret}`, accept: 'text/event-stream' } });
    expect(getRes.status).toBe(405);
    const deleteRes = await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${secret}` } });
    expect(deleteRes.status).toBe(405);

    await app.close();
  });

  test('a CI token is rejected outright, even before listing tools', async () => {
    const { app, baseUrl } = await startApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { name: 'ci', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;

    const res = await fetch(`${baseUrl}/mcp/${project.graphProjectId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ci_tokens_cannot_use_mcp');

    await app.close();
  });

  test('a token from another org gets 404 for a project it does not own (no IDOR signal)', async () => {
    const { app, baseUrl } = await startApp();
    const { project } = await setupProject(app);
    const { secret: otherOrgSecret } = await setupProject(app);

    const res = await fetch(`${baseUrl}/mcp/${project.graphProjectId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${otherOrgSecret}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(404);

    await app.close();
  });

  test('an Origin outside the trusted allowlist is rejected; a trusted or absent Origin is fine', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProject(app);
    const url = `${baseUrl}/mcp/${project.graphProjectId}`;

    const untrusted = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://evil.example.test' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(untrusted.status).toBe(403);

    const trusted = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        origin: 'https://trusted.example.test',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(trusted.status).toBe(200);

    await app.close();
  });

  test('bare /mcp exposes only list_projects', async () => {
    const { app, baseUrl } = await startApp();
    const { secret } = await setupProject(app);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(`${baseUrl}/mcp`, secret));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_projects']);

    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(result.isError).toBeFalsy();
    await client.close();
    await app.close();
  });

  test('a token without mcp:write can read but a write tool call is denied with missing_scope', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProject(app, ['mcp:read']);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(`${baseUrl}/mcp/${project.graphProjectId}`, secret));
    const readResult = await client.callTool({ name: 'list_work_orders', arguments: {} });
    expect(readResult.isError).toBeFalsy();

    const writeResult = await client.callTool({ name: 'submit_feedback', arguments: { text: 'x', source: 'call' } });
    expect(writeResult.isError).toBe(true);
    const content = writeResult.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]!.text).error).toBe('missing_scope');

    await client.close();
    await app.close();
  });

  test('a personal token restricted to a different project_ids set gets 404 for this project, with no canary leak (WO-185)', async () => {
    const { app, baseUrl } = await startApp();
    const canary = `CANARY-${Math.random().toString(36).slice(2)}`;
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const targetProject = await createProjectFixture(pg, { orgId: org.id, name: `Target ${canary}` });
    const otherProject = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: targetProject.graphProjectId, name: targetProject.name, root: `saas://project/${targetProject.id}` });
    await store.clear();
    const cookie = await signIn(app, owner.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { orgSlug: org.slug, name: 'scoped', scopes: ['mcp:read'], projectIds: [otherProject.id], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const scopedSecret = created.json().secret as string;

    const res = await fetch(`${baseUrl}/mcp/${targetProject.graphProjectId}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${scopedSecret}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(canary);

    await app.close();
  });

  test('resources/read and prompts/get without mcp:read are rejected with missing_scope (WO-232), matching how a scope-less tool call is already rejected', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProject(app, ['mcp:write']);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(`${baseUrl}/mcp/${project.graphProjectId}`, secret));

    await expect(client.readResource({ uri: 'prdm://project' })).rejects.toThrow(/mcp:read/);
    await expect(client.getPrompt({ name: 'implement_work_order', arguments: { id: 'WO-001' } })).rejects.toThrow(/mcp:read/);

    await client.close();
    await app.close();
  });

  test('a successful resource read and a prompt get each produce an audit-log entry with the correct name (WO-232)', async () => {
    const { app, baseUrl } = await startApp();
    const { org, project, secret } = await setupProject(app, ['mcp:read']);

    // `implement_work_order` needs a real work order to build its context bundle around.
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'SDD-001', 'SDD', 'Design', 'docs/blueprints/SDD-001.md', 'generated', 'published', $4, 'h1')`,
      [randomUUID(), org.id, project.id, '---\nid: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/**"]\n---\n## Tareas\n- [ ] x\n'],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'WO-001', 'WO', 'Task', 'docs/work-orders/WO-001.md', 'generated', 'published', $4, 'h2')`,
      [randomUUID(), org.id, project.id, '---\nid: WO-001\ntype: WO\ntitle: Task\nstatus: pending\nimplements: [SDD-001]\n---\ntask\n'],
    );
    // `getWorkOrderContext` (used by the `implement_work_order` prompt) reads from the Neo4j-projected
    // graph, not straight from `documents` — marking `graph_dirty` makes the next read (`ensureRecovered`)
    // actually build and write that snapshot before the prompt's handler runs.
    await pg.ownerPool.query(`UPDATE "projects" SET graph_dirty = true WHERE id = $1`, [project.id]);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(`${baseUrl}/mcp/${project.graphProjectId}`, secret));

    await client.readResource({ uri: 'prdm://project' });
    await client.getPrompt({ name: 'implement_work_order', arguments: { id: 'WO-001' } });

    const { rows } = await pg.ownerPool.query(`SELECT action, target FROM "audit_log" WHERE project_id = $1 AND target IN ('project', 'implement_work_order') ORDER BY target`, [project.id]);
    expect(rows).toEqual([
      { action: 'mcp.tool_call', target: 'implement_work_order' },
      { action: 'mcp.tool_call', target: 'project' },
    ]);

    await client.close();
    await app.close();
  });

  test('two generate_work_orders in a row over the same checklist create nothing the second time (WO-646)', async () => {
    const { app, baseUrl } = await startApp();
    const { org, project, secret } = await setupProject(app);
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'SDD-001', 'SDD', 'Design', 'docs/blueprints/SDD-001.md', 'generated', 'published', $4, 'h1')`,
      [randomUUID(), org.id, project.id, '---\nid: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/**"]\n---\n## Tareas\n- [ ] uno\n- [ ] dos\n'],
    );
    const countWos = async () => (await pg.ownerPool.query(`SELECT count(*)::int AS n FROM "documents" WHERE project_id = $1 AND kind = 'WO'`, [project.id])).rows[0].n as number;

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(`${baseUrl}/mcp/${project.graphProjectId}`, secret));
    const generate = async () => {
      const startedAt = Date.now();
      const res = await client.callTool({ name: 'generate_work_orders', arguments: { blueprint_id: 'SDD-001' } });
      const elapsed = Date.now() - startedAt;
      expect(res.isError).toBeFalsy();
      return { body: JSON.parse((res.content as { text: string }[])[0]!.text) as { created: { id: string }[]; skipped: number }, elapsed };
    };

    const first = await generate();
    const second = await generate();
    console.log(`generate_work_orders timings: first=${first.elapsed}ms second=${second.elapsed}ms`);

    expect(first.body.created).toHaveLength(2);
    expect(second.body.created).toHaveLength(0);
    expect(second.body.skipped).toBe(2);
    expect(await countWos()).toBe(2);

    const listed = await client.callTool({ name: 'list_work_orders', arguments: { blueprint_id: 'SDD-001' } });
    const ids = (JSON.parse((listed.content as { text: string }[])[0]!.text) as { results: { id: string }[] }).results.map((r) => r.id);
    expect(ids.sort()).toEqual(first.body.created.map((c) => c.id).sort());

    await client.close();
    await app.close();
  });

  test('the rate limit counts resource and prompt calls the same way it counts tool calls, sharing one per-token budget (WO-232)', async () => {
    const { app, baseUrl } = await startApp();
    const { project, secret } = await setupProject(app, ['mcp:read']);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(buildClientTransport(`${baseUrl}/mcp/${project.graphProjectId}`, secret));

    // Spend the whole per-token budget on cheap, side-effect-free resource reads (the static
    // `artifact-template` resource never touches Postgres/Neo4j), interleaved with a couple of real
    // tool calls, to prove they draw from the exact same counter as `instrumentMcpCalls` already gives
    // every tool call.
    for (let i = 0; i < DEFAULT_MCP_TOOL_RATE_LIMIT_PER_MINUTE - 1; i++) {
      await client.readResource({ uri: 'prdm://templates/SDD' });
    }
    const stillWithinBudget = await client.callTool({ name: 'list_work_orders', arguments: {} });
    expect(stillWithinBudget.isError).toBeFalsy();

    // The budget (tool calls + resource reads combined) is now exhausted: the next call of either kind
    // is rejected, and a fresh prompt get is rejected too — proving prompts share the same counter.
    await expect(client.readResource({ uri: 'prdm://templates/SDD' })).rejects.toThrow(/too many tool calls/);
    await expect(client.getPrompt({ name: 'implement_work_order', arguments: { id: 'WO-001' } })).rejects.toThrow(/too many tool calls/);

    await client.close();
    await app.close();
  }, 30_000);
});
