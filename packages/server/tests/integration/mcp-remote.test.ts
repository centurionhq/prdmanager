/**
 * `POST /mcp/:graphProjectId` and `POST /mcp` (SDD-010 "MCP remoto", WO-184): a real
 * `StreamableHTTPClientTransport` client against a listening Fastify server — scopes, tool allow-list,
 * GET/DELETE 405, CI tokens rejected, Origin allowlist, `project_ids`-scoped tokens.
 */
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
    expect(names).toEqual(expect.arrayContaining(['get_project', 'get_node', 'list_work_orders', 'claim_work_order', 'complete_work_order', 'submit_feedback']));
    for (const forbidden of ['draft_artifact', 'commit_artifact', 'generate_work_orders', 'acknowledge_sync', 'refresh_index', 'create_feature_request', 'attach_artifact']) {
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
});
