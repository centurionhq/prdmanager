/**
 * WO-253/WO-258 (security review, final PRD-005-wide pass): a session revoked mid-turn must abort the
 * agent's SSE stream, the same instant `/collab` already does via `databaseHooks.session.delete.after`
 * (WO-220) — `documents-agent.ts` previously only re-checked *role/membership* per tool call, never
 * *session validity*, so a revoked session's in-flight turn (which can legitimately run for several
 * minutes, WO-227) kept running under its authority regardless.
 *
 * Never a wall-clock wait: a custom `LlmClient` pauses its stream on a promise the test controls,
 * signalling (via another promise) once it has actually started, so `POST /api/auth/sign-out` — which
 * runs synchronously to completion inside the *same* request/response cycle as the hook that calls
 * `agentStreamRevocationHub.revokeUser` — is guaranteed to run, and its abort observed, before the
 * paused stream is ever allowed to continue.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import type { LlmClient, LlmEvent } from '../../src/agent/llm-client.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

const PASSWORD = 'correct-horse-battery-staple';

/** Yields one token, signals `started`, then pauses on `gate` until the test resolves it — by which point
 * the revoking sign-out request has already completed and `controller.signal` is already aborted. */
function createPausableLlmClient(): { client: LlmClient; started: Promise<void>; resumeStream: () => void } {
  let resumeStream!: () => void;
  const gate = new Promise<void>((resolve) => {
    resumeStream = resolve;
  });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });

  const client: LlmClient = {
    async *streamChat(): AsyncIterable<LlmEvent> {
      yield { type: 'token', text: 'thinking...' };
      signalStarted();
      await gate;
      yield { type: 'done', finishReason: 'stop' };
    },
  };

  return { client, started, resumeStream };
}

describe('agent SSE stream is aborted when its session is revoked mid-turn (WO-253/WO-258)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const ORIGIN = () => env.publicUrl;

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

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  test('sign-out (session revoked) aborts an in-flight agent turn instead of letting it finish normally', async () => {
    const { client, started, resumeStream } = createPausableLlmClient();
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j, llmClient: client });

    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);

    const editorCookie = await signIn(app, editor.email);
    const docRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { kind: 'PRD', title: 'Revocation test doc' },
    });
    expect(docRes.statusCode).toBe(200);
    const docId = docRes.json().document.docId as string;

    const streamPromise = app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/agent/messages`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
      payload: { message: 'hi there' },
    });

    // Real event, not a timer: the fake client itself signals once it has started streaming and is
    // paused, waiting for `resumeStream()`.
    await started;

    const signOutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      payload: {},
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), editorCookie),
    });
    expect(signOutRes.statusCode).toBe(200);

    // The sign-out request above only resolves after databaseHooks.session.delete.after has run
    // synchronously to completion — by this point agentStreamRevocationHub.revokeUser has already
    // called .abort() on the streaming turn's controller.
    resumeStream();
    const streamRes = await streamPromise;

    expect(streamRes.statusCode).toBe(200);
    expect(streamRes.payload).toContain('event: done');
    expect(streamRes.payload).toContain(JSON.stringify({ type: 'done', finishReason: 'aborted' }));
    expect(streamRes.payload).not.toContain(JSON.stringify({ type: 'done', finishReason: 'stop' }));

    await app.close();
  });
});
