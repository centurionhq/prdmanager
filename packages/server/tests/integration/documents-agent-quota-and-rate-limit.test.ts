/**
 * WO-175 — `POST .../agent/messages` enforces the per-user RPM rate limit and the per-org/global daily
 * token quota before ever calling the model, with sanitized 429 responses, and never leaks the DeepSeek
 * key into logs even when the (fake, in these tests) provider fails.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { createDeepSeekClient } from '../../src/agent/deepseek-client.js';
import { createFakeLlmClient } from '../../src/agent/fake-llm-client.js';
import { createClockStore } from '../../src/rate-limit/clock-store.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

const FAKE_DEEPSEEK_KEY = 'sk-should-never-leak-into-any-log-line';

function fakeClock(startMs = 0) {
  let current = startMs;
  return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
}

describe('.../agent/messages rate limit and quota (SDD-009 §Seguridad y costo, WO-175)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  const PASSWORD = 'correct-horse-battery-staple';

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  async function signIn(app: ReturnType<typeof buildServer>, env: ReturnType<typeof buildTestServerEnv>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: { host: new URL(env.publicUrl).host } });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function setupEditorAndDocument(app: ReturnType<typeof buildServer>, env: ReturnType<typeof buildTestServerEnv>) {
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    const cookie = await signIn(app, env, editor.email);

    const docRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, cookie),
      payload: { kind: 'PRD', title: 'Quota test doc' },
    });
    expect(docRes.statusCode).toBe(200);
    return { editor, org, project, cookie, docId: docRes.json().document.docId as string };
  }

  function messagesUrl(org: { slug: string }, project: { slug: string }, docId: string): string {
    return `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/agent/messages`;
  }

  test('a request beyond PRDM_AGENT_RPM_PER_USER gets 429 with no internal detail, never reaching the model', async () => {
    const clock = fakeClock();
    const env = buildTestServerEnv({ agentQuotas: { dailyTokensPerOrg: 200_000, dailyTokensGlobal: 2_000_000, rpmPerUser: 1 } });
    const llmClient = createFakeLlmClient([[{ type: 'token', text: 'first reply' }, { type: 'done', finishReason: 'stop' }]]);
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, llmClient, neo4j, rateLimitStore: createClockStore(() => clock.now()) });
    const { org, project, cookie, docId } = await setupEditorAndDocument(app, env);

    const first = await app.inject({
      method: 'POST',
      url: messagesUrl(org, project, docId),
      headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, cookie),
      payload: { message: 'first' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: messagesUrl(org, project, docId),
      headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, cookie),
      payload: { message: 'second' },
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: { code: 'rate_limited', message: expect.any(String) } });
    expect(second.headers['retry-after']).toBeDefined();

    await app.close();
  });

  test('a request that would exceed the per-organization daily token quota gets 429 without calling the model', async () => {
    const env = buildTestServerEnv({ agentQuotas: { dailyTokensPerOrg: 1, dailyTokensGlobal: 2_000_000, rpmPerUser: 100 } });
    const llmClient = createFakeLlmClient([]); // the script is empty on purpose: streamChat must never be called
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, llmClient, neo4j });
    const { org, project, cookie, docId } = await setupEditorAndDocument(app, env);

    const res = await app.inject({
      method: 'POST',
      url: messagesUrl(org, project, docId),
      headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, cookie),
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: { code: 'rate_limited', message: expect.any(String) } });
    expect(llmClient.calls).toHaveLength(0);

    const { rows } = await pg.ownerPool.query(`SELECT count(*)::int AS count FROM agent_conversations WHERE org_id = $1`, [org.id]);
    expect(rows[0].count).toBe(0); // rejected before ever creating a conversation

    await app.close();
  });

  test('a request under quota succeeds and reconciles the reservation down to what was actually used', async () => {
    const env = buildTestServerEnv({ agentQuotas: { dailyTokensPerOrg: 200_000, dailyTokensGlobal: 2_000_000, rpmPerUser: 100 } });
    const llmClient = createFakeLlmClient([
      [{ type: 'token', text: 'hi' }, { type: 'usage', promptTokens: 10, completionTokens: 5, totalTokens: 15 }, { type: 'done', finishReason: 'stop' }],
    ]);
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, llmClient, neo4j });
    const { org, project, cookie, docId } = await setupEditorAndDocument(app, env);

    const res = await app.inject({
      method: 'POST',
      url: messagesUrl(org, project, docId),
      headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, cookie),
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await pg.ownerPool.query(`SELECT total_tokens FROM llm_usage WHERE org_id = $1`, [org.id]);
    // Reserved DEFAULT_MAX_TOKENS_PER_TURN (8000) up front, then reconciled down to the 15 actually used.
    expect(rows[0].total_tokens).toBe(15);

    await app.close();
  });

  test('the DeepSeek API key never appears in any server log line, even when the provider itself fails', async () => {
    const lines: string[] = [];
    const stream = { write: (chunk: string) => void lines.push(chunk) } as unknown as NodeJS.WritableStream;
    const env = buildTestServerEnv({ deepseek: { apiKey: FAKE_DEEPSEEK_KEY, baseUrl: 'http://127.0.0.1:1', model: 'deepseek-v4-flash' } });
    // A real DeepSeekClient pointed at a port nothing listens on — every call fails, exercising the exact
    // error path (and its own error/log payload) that could otherwise leak the key.
    const llmClient = createDeepSeekClient({ apiKey: env.deepseek!.apiKey, baseUrl: env.deepseek!.baseUrl, model: env.deepseek!.model });
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: { level: 'info', stream }, llmClient, neo4j });
    const { org, project, cookie, docId } = await setupEditorAndDocument(app, env);

    const res = await app.inject({
      method: 'POST',
      url: messagesUrl(org, project, docId),
      headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, cookie),
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('llm_error');

    await app.close();
    const output = lines.join('');
    expect(output).not.toContain(FAKE_DEEPSEEK_KEY);
  });
});
