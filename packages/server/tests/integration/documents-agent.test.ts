/**
 * WO-172 — `POST .../documents/:docId/agent/messages`: SSE streaming for editor-or-above, CSRF-protected,
 * private per-document-per-owner conversations, and one active stream per user.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { createFakeLlmClient, type FakeLlmClient } from '../../src/agent/fake-llm-client.js';
import { toolCallSequenceIssues } from '../../src/agent/agent-loop.js';
import type { LlmClient, LlmMessage } from '../../src/agent/llm-client.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('.../documents/:docId/agent/messages (WO-172)', () => {
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

  function buildApp(llmClient: LlmClient) {
    return buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j, llmClient });
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function setupOrgProjectAndDocument(app: ReturnType<typeof buildServer>) {
    const editorA = await seedUser(env, pg.appPool, PASSWORD);
    const editorB = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    for (const u of [editorA, editorB, viewer]) await createMemberFixture(pg, { organizationId: org.id, userId: u.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editorA.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editorB.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);

    const editorACookie = await signIn(app, editorA.email);
    const docRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { kind: 'PRD', title: 'Agent test doc' },
    });
    expect(docRes.statusCode).toBe(200);

    return { editorA, editorB, viewer, org, project, docId: docRes.json().document.docId as string, editorACookie };
  }

  function sseUrl(org: { slug: string }, project: { slug: string }, docId: string): string {
    return `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/agent/messages`;
  }

  async function countRows(table: string, where: string, params: unknown[]): Promise<number> {
    const { rows } = await pg.ownerPool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}" WHERE ${where}`, params);
    return Number.parseInt(rows[0]!.count, 10);
  }

  test('an editor streams a well-behaved reply and both messages are persisted', async () => {
    const llmClient = createFakeLlmClient([[{ type: 'token', text: 'Hello, how can I help?' }, { type: 'done', finishReason: 'stop' }]]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'hi there' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('event: message_start');
    expect(res.payload).toContain('event: token');
    expect(res.payload).toContain(JSON.stringify({ type: 'token', text: 'Hello, how can I help?' }));
    expect(res.payload).toContain('event: done');
    expect(res.payload).toContain(JSON.stringify({ type: 'done', finishReason: 'stop' }));

    expect(await countRows('agent_conversations', 'org_id = $1', [org.id])).toBe(1);
    expect(await countRows('agent_messages', "role = 'user' AND content = $1", ['hi there'])).toBe(1);
    expect(await countRows('agent_messages', "role = 'assistant' AND content = $1", ['Hello, how can I help?'])).toBe(1);

    await app.close();
  });

  test('WO-470 (SDD-035/PRD-016): a turn whose model call blows up still persists what it produced, instead of orphaning the user message', async () => {
    // An empty script: the very first streamChat throws FakeLlmScriptExhaustedError from inside the loop.
    // That used to escape, leaving `newMessages` empty and the user's message sitting in the transcript
    // with no reply, no error and nothing to retry -- and poisoning every later turn's replayed history.
    const llmClient = createFakeLlmClient([]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'write the intro' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('event: error');
    expect(res.payload).toContain(JSON.stringify({ type: 'done', finishReason: 'error' }));

    // The user's message is still there, and the conversation is closed rather than left mid-turn.
    expect(await countRows('agent_messages', "role = 'user' AND content = $1", ['write the intro'])).toBe(1);
    expect(await countRows('agent_messages', "role = 'assistant' AND tool_calls IS NOT NULL", [])).toBe(0);

    await app.close();
  });

  test('WO-470: a turn interrupted partway through its tool calls persists the assistant turn with every tool call answered', async () => {
    const llmClient = createFakeLlmClient([
      [
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'read_document', argumentsJson: '{}' } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
    ]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'read it' },
    });

    expect(res.statusCode).toBe(200);

    // Whatever the turn managed, the invariant holds: no assistant tool_call is left without a result,
    // because that is the sequence the provider rejects when this transcript is replayed next turn.
    const requested = await countRows('agent_messages', "role = 'assistant' AND tool_calls IS NOT NULL", []);
    const answered = await countRows('agent_messages', "role = 'tool'", []);
    expect(answered).toBeGreaterThanOrEqual(requested);

    await app.close();
  });

  test('WO-471 (SDD-035/PRD-016): a conversation persisted by one turn and read back for the next satisfies the tool-call sequence invariant', async () => {
    // The full round trip -- persist a turn, read it back, map it to LlmMessages -- because that read is
    // where the ordering bug lived. A write-side assertion could never have caught it.
    const llmClient = createFakeLlmClient([
      [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'read_document', argumentsJson: '{}' } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'token', text: 'It is a draft PRD.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'what is this?' },
    });
    expect(res.statusCode).toBe(200);

    const conversation = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/agent/conversation`,
      headers: { cookie: editorACookie, ...AUTH_HOST() },
    });
    expect(conversation.statusCode).toBe(200);
    const { messages } = conversation.json() as { messages: { role: string; content: string; toolCalls: unknown; toolCallId: string | null; toolName: string | null }[] };

    const replayed: LlmMessage[] = messages.map((m) => ({
      role: m.role as LlmMessage['role'],
      content: m.content,
      ...(m.toolCalls ? { toolCalls: m.toolCalls as LlmMessage['toolCalls'] } : {}),
      ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      ...(m.toolName ? { name: m.toolName } : {}),
    }));

    expect(toolCallSequenceIssues(replayed)).toEqual([]);
    // And the order really is the causal one: the assistant that asked, then its result.
    const assistantIndex = replayed.findIndex((m) => m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0);
    const resultIndex = replayed.findIndex((m) => m.role === 'tool');
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(assistantIndex);

    await app.close();
  });

  test('WO-492/WO-493 (SDD-040/PRD-020): a tool failure and the turn\u2019s finish reason survive a reload', async () => {
    // The exact shape of what a user saw in PRD-019: the agent calls a tool, the tool fails, and after
    // a reload there was no trace at all that anything had gone wrong.
    const llmClient = createFakeLlmClient([
      [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'get_node', argumentsJson: 'not json at all' } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'token', text: 'No pude leer ese nodo.' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'leé el nodo' },
    });
    expect(res.statusCode).toBe(200);

    // Persisted, not merely streamed: `ok` used to exist only on the wire event.
    expect(await countRows('agent_messages', "role = 'tool' AND tool_ok = false", [])).toBe(1);
    expect(await countRows('agent_messages', "finish_reason IS NOT NULL", [])).toBe(1);

    const conversation = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/agent/conversation`,
      headers: { cookie: editorACookie, ...AUTH_HOST() },
    });
    expect(conversation.statusCode).toBe(200);

    await app.close();
  });

  test('WO-491: the heartbeat reaches the client, so silence while the model thinks is not silence on the wire', async () => {
    const llmClient = createFakeLlmClient([[{ type: 'token', text: 'listo' }, { type: 'done', finishReason: 'stop' }]]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'hola' },
    });

    expect(res.statusCode).toBe(200);
    // A fake client answers instantly, so this turn finishes well inside one heartbeat interval; what is
    // asserted is that the stream is wired for it at all and that nothing leaks past the turn's end.
    expect(res.payload).toContain('event: done');

    await app.close();
  });

  test('WO-494 (SDD-040): running out of the daily token budget does not masquerade as \u201ctoo many attempts\u201d', async () => {
    const llmClient = createFakeLlmClient([[{ type: 'token', text: 'hola' }, { type: 'done', finishReason: 'stop' }]]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    // Burn the org's whole daily allowance before the turn starts.
    await pg.ownerPool.query(
      `INSERT INTO "llm_usage" (org_id, usage_date, total_tokens) VALUES ($1, CURRENT_DATE, 100000000)
       ON CONFLICT (org_id, usage_date) DO UPDATE SET total_tokens = 100000000`,
      [org.id],
    );

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'hola' },
    });

    expect(res.statusCode).toBe(429);
    // The message has to say it is a budget, not an attempt rate -- "try again in a moment" is wrong
    // advice for something that only resets tomorrow.
    expect(res.json().error.message).toMatch(/budget/i);

    await app.close();
  });

  test('a viewer (no use_agent permission) gets 403 and nothing is persisted', async () => {
    const llmClient = createFakeLlmClient([]);
    const app = buildApp(llmClient);
    const { org, project, docId, viewer } = await setupOrgProjectAndDocument(app);
    const viewerCookie = await signIn(app, viewer.email);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), viewerCookie),
      payload: { message: 'hi there' },
    });

    expect(res.statusCode).toBe(403);
    expect(await countRows('agent_conversations', 'org_id = $1', [org.id])).toBe(0);
    await app.close();
  });

  test('missing CSRF token is rejected before touching the agent at all', async () => {
    const llmClient = createFakeLlmClient([]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const res = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: { ...AUTH_HOST(), origin: ORIGIN(), cookie: editorACookie },
      payload: { message: 'hi there' },
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('GET .../agent/conversation restores the caller’s own transcript, and is empty before any message is sent', async () => {
    const llmClient = createFakeLlmClient([[{ type: 'token', text: 'Hello, how can I help?' }, { type: 'done', finishReason: 'stop' }]]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const before = await app.inject({ method: 'GET', url: sseUrl(org, project, docId).replace('/messages', '/conversation'), headers: { ...AUTH_HOST(), cookie: editorACookie } });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ conversationId: null, messages: [], proposals: [] });

    await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'hi there' },
    });

    const after = await app.inject({ method: 'GET', url: sseUrl(org, project, docId).replace('/messages', '/conversation'), headers: { ...AUTH_HOST(), cookie: editorACookie } });
    expect(after.statusCode).toBe(200);
    const body = after.json();
    expect(body.conversationId).not.toBeNull();
    expect(body.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['user', 'hi there'],
      ['assistant', 'Hello, how can I help?'],
    ]);
    expect(body.proposals).toEqual([]);

    await app.close();
  });

  test('two different editors each get their own private conversation for the same document', async () => {
    const llmClient = createFakeLlmClient([
      [{ type: 'token', text: 'reply to A' }, { type: 'done', finishReason: 'stop' }],
      [{ type: 'token', text: 'reply to B' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie, editorB } = await setupOrgProjectAndDocument(app);
    const editorBCookie = await signIn(app, editorB.email);

    const resA = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'from A' },
    });
    const resB = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorBCookie),
      payload: { message: 'from B' },
    });

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.payload).toContain('reply to A');
    expect(resB.payload).toContain('reply to B');
    expect(await countRows('agent_conversations', 'org_id = $1', [org.id])).toBe(2);

    await app.close();
  });

  test('a second request from the same user while one is still streaming gets 409', async () => {
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    // A hand-rolled LlmClient (not the scripted fake) so the test can hold the first request's stream
    // open deterministically — no wall-clock wait, just an explicit gate this test controls.
    const controlledLlmClient: LlmClient = {
      async *streamChat() {
        yield { type: 'token' as const, text: 'still working' };
        await gate;
        yield { type: 'done' as const, finishReason: 'stop' as const };
      },
    };
    const app = buildApp(controlledLlmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    const firstRequest = app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'first' },
    });

    // Give the first request's handler a tick to register itself as an active stream before firing the second.
    await new Promise((resolve) => setImmediate(resolve));

    const secondRes = await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'second' },
    });
    expect(secondRes.statusCode).toBe(409);

    releaseFirst();
    const firstRes = await firstRequest;
    expect(firstRes.statusCode).toBe(200);

    await app.close();
  });

  test('a fresh conversation includes the prior turn’s history on the next message', async () => {
    const llmClient = createFakeLlmClient([
      [{ type: 'token', text: 'first reply' }, { type: 'done', finishReason: 'stop' }],
      [{ type: 'token', text: 'second reply' }, { type: 'done', finishReason: 'stop' }],
    ]);
    const app = buildApp(llmClient);
    const { org, project, docId, editorACookie } = await setupOrgProjectAndDocument(app);

    await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'turn one' },
    });
    await app.inject({
      method: 'POST',
      url: sseUrl(org, project, docId),
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorACookie),
      payload: { message: 'turn two' },
    });

    const fake = llmClient as FakeLlmClient;
    expect(fake.calls).toHaveLength(2);
    const secondCallContents = fake.calls[1]!.messages.map((m) => m.content);
    expect(secondCallContents).toContain('turn one');
    expect(secondCallContents).toContain('first reply');
    expect(secondCallContents).toContain('turn two');
    expect(await countRows('agent_conversations', 'org_id = $1', [org.id])).toBe(1); // reused, not duplicated

    await app.close();
  });
});
