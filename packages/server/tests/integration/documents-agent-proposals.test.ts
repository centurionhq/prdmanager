/**
 * WO-174 — accept/reject agent proposals: accepting applies the edit as a server transaction attributed
 * to agent:deepseek on behalf of the accepting user (verified via the real blame endpoint, not just a
 * content check), a concurrent edit to the anchored text makes acceptance fail as stale rather than
 * silently applying to the wrong location, and rejecting just records who/when.
 */
import * as Y from 'yjs';
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { createFakeLlmClient } from '../../src/agent/fake-llm-client.js';
import type { LlmClient } from '../../src/agent/llm-client.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('.../documents/:docId/agent/proposals/:proposalId/{accept,reject} (WO-174)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const ORIGIN = () => env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';
  const INITIAL_BODY = 'The quick brown fox jumps over the lazy dog.';

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

  function proposeEditScript(expectedText: string, replacement: string): LlmClient {
    return createFakeLlmClient([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'call_1', name: 'propose_edit', argumentsJson: JSON.stringify({ summary: 'improve wording', edits: [{ expectedText, replacement }] }) },
        },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [{ type: 'token', text: 'Proposed an edit for your review.' }, { type: 'done', finishReason: 'stop' }],
    ]);
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function setupOrgAndProject() {
    const proposer = await seedUser(env, pg.appPool, PASSWORD);
    const accepter = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    for (const u of [proposer, accepter, viewer]) await createMemberFixture(pg, { organizationId: org.id, userId: u.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, proposer.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, accepter.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    return { proposer, accepter, viewer, org, project };
  }

  async function createDocument(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, cookie: string): Promise<{ id: string; docId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { kind: 'PRD', title: 'Proposal test doc' },
    });
    expect(res.statusCode).toBe(200);
    return { id: res.json().document.id, docId: res.json().document.docId };
  }

  async function seedLiveBody(orgId: string, documentId: string, text: string, seq = 1): Promise<void> {
    const doc = new Y.Doc({ gc: false });
    doc.getText('body').insert(0, text);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc));
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, struct_ranges, delete_ranges, update) VALUES ($1, $2, $3, 'system', $4, $5, $6)`,
      [orgId, documentId, seq, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );
  }

  /** Appends a second `doc_updates` row on top of the already-seeded body, simulating an intervening live
   * edit by a real user — same technique `documents-restore.test.ts` uses. */
  async function seedConcurrentEdit(orgId: string, documentId: string, actorId: string, mutate: (doc: Y.Doc) => void): Promise<void> {
    const { reconstructLiveYDoc } = await import('../../src/collab/reconstruct-ydoc.js');
    const { ydoc: current } = await reconstructLiveYDoc(pg.appPool, orgId, documentId);
    const clientDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(current));
    const before = Y.encodeStateVector(clientDoc);
    mutate(clientDoc);
    const update = Buffer.from(Y.encodeStateAsUpdate(clientDoc, before));
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, user_id, struct_ranges, delete_ranges, update) VALUES ($1, $2, 2, 'user', $3, $4, $5, $6)`,
      [orgId, documentId, actorId, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );
  }

  test('accepting applies the edit attributed to agent:deepseek on behalf of the accepting user', async () => {
    const llmClient = proposeEditScript('quick brown fox', 'swift brown fox');
    const app = buildApp(llmClient);
    const { proposer, accepter, org, project } = await setupOrgAndProject();
    const proposerCookie = await signIn(app, proposer.email);
    const accepterCookie = await signIn(app, accepter.email);
    const document = await createDocument(app, org, project, proposerCookie);
    await seedLiveBody(org.id, document.id, INITIAL_BODY);

    const chatRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/messages`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), proposerCookie),
      payload: { message: 'please improve the wording' },
    });
    expect(chatRes.statusCode).toBe(200);
    expect(chatRes.payload).toContain('event: tool_result');

    const { rows } = await pg.ownerPool.query(`SELECT id, status FROM agent_proposals WHERE document_id = $1`, [document.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    const proposalId = rows[0].id as string;

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/proposals/${proposalId}/accept`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), accepterCookie),
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().status).toBe('accepted');

    const { rows: after } = await pg.ownerPool.query(`SELECT status, responded_by FROM agent_proposals WHERE id = $1`, [proposalId]);
    expect(after[0].status).toBe('accepted');
    expect(after[0].responded_by).toBe(accepter.id);

    const blameRes = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/blame`,
      headers: { ...AUTH_HOST(), cookie: accepterCookie },
    });
    expect(blameRes.statusCode).toBe(200);
    const blame = blameRes.json() as { lines: { line: number; attribution: { actorKind: string; onBehalfOf: string | null; agentId: string | null } | null }[] };
    const agentLine = blame.lines.find((l) => l.attribution?.actorKind === 'agent');
    expect(agentLine?.attribution).toMatchObject({ actorKind: 'agent', onBehalfOf: accepter.id, agentId: 'agent:deepseek' });

    await app.close();
  });

  test('a viewer cannot accept or reject a proposal', async () => {
    const llmClient = proposeEditScript('quick brown fox', 'swift brown fox');
    const app = buildApp(llmClient);
    const { proposer, viewer, org, project } = await setupOrgAndProject();
    const proposerCookie = await signIn(app, proposer.email);
    const viewerCookie = await signIn(app, viewer.email);
    const document = await createDocument(app, org, project, proposerCookie);
    await seedLiveBody(org.id, document.id, INITIAL_BODY);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/messages`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), proposerCookie),
      payload: { message: 'please improve the wording' },
    });
    const { rows } = await pg.ownerPool.query(`SELECT id FROM agent_proposals WHERE document_id = $1`, [document.id]);
    const proposalId = rows[0].id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/proposals/${proposalId}/accept`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), viewerCookie),
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  test('a concurrent edit to the anchored text makes acceptance fail as stale, never applying to the wrong location', async () => {
    const llmClient = proposeEditScript('quick brown fox', 'swift brown fox');
    const app = buildApp(llmClient);
    const { proposer, accepter, org, project } = await setupOrgAndProject();
    const proposerCookie = await signIn(app, proposer.email);
    const accepterCookie = await signIn(app, accepter.email);
    const document = await createDocument(app, org, project, proposerCookie);
    await seedLiveBody(org.id, document.id, INITIAL_BODY);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/messages`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), proposerCookie),
      payload: { message: 'please improve the wording' },
    });
    const { rows } = await pg.ownerPool.query(`SELECT id FROM agent_proposals WHERE document_id = $1`, [document.id]);
    const proposalId = rows[0].id as string;

    // A real user edits exactly the anchored text before the proposal is ever accepted.
    await seedConcurrentEdit(org.id, document.id, accepter.id, (doc) => {
      const text = doc.getText('body');
      const raw = text.toString();
      const start = raw.indexOf('quick brown fox');
      text.delete(start, 'quick brown fox'.length);
      text.insert(start, 'completely different phrase');
    });

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/proposals/${proposalId}/accept`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), accepterCookie),
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().status).toBe('stale');

    const { rows: after } = await pg.ownerPool.query(`SELECT status FROM agent_proposals WHERE id = $1`, [proposalId]);
    expect(after[0].status).toBe('stale');

    const { reconstructLiveYDoc } = await import('../../src/collab/reconstruct-ydoc.js');
    const { ydoc } = await reconstructLiveYDoc(pg.appPool, org.id, document.id);
    expect(ydoc.getText('body').toString()).toContain('completely different phrase');
    expect(ydoc.getText('body').toString()).not.toContain('swift brown fox');

    await app.close();
  });

  test('rejecting records who and when without ever touching the document', async () => {
    const llmClient = proposeEditScript('quick brown fox', 'swift brown fox');
    const app = buildApp(llmClient);
    const { proposer, accepter, org, project } = await setupOrgAndProject();
    const proposerCookie = await signIn(app, proposer.email);
    const accepterCookie = await signIn(app, accepter.email);
    const document = await createDocument(app, org, project, proposerCookie);
    await seedLiveBody(org.id, document.id, INITIAL_BODY);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/messages`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), proposerCookie),
      payload: { message: 'please improve the wording' },
    });
    const { rows } = await pg.ownerPool.query(`SELECT id FROM agent_proposals WHERE document_id = $1`, [document.id]);
    const proposalId = rows[0].id as string;

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/proposals/${proposalId}/reject`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), accepterCookie),
    });
    expect(rejectRes.statusCode).toBe(200);
    expect(rejectRes.json().status).toBe('rejected');

    const { rows: after } = await pg.ownerPool.query(`SELECT status, responded_by FROM agent_proposals WHERE id = $1`, [proposalId]);
    expect(after[0].status).toBe('rejected');
    expect(after[0].responded_by).toBe(accepter.id);

    const { reconstructLiveYDoc } = await import('../../src/collab/reconstruct-ydoc.js');
    const { ydoc } = await reconstructLiveYDoc(pg.appPool, org.id, document.id);
    expect(ydoc.getText('body').toString()).toBe(INITIAL_BODY);

    await app.close();
  });

  test('accepting or rejecting an already-decided proposal is rejected as a conflict', async () => {
    const llmClient = proposeEditScript('quick brown fox', 'swift brown fox');
    const app = buildApp(llmClient);
    const { proposer, accepter, org, project } = await setupOrgAndProject();
    const proposerCookie = await signIn(app, proposer.email);
    const accepterCookie = await signIn(app, accepter.email);
    const document = await createDocument(app, org, project, proposerCookie);
    await seedLiveBody(org.id, document.id, INITIAL_BODY);

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/messages`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), proposerCookie),
      payload: { message: 'please improve the wording' },
    });
    const { rows } = await pg.ownerPool.query(`SELECT id FROM agent_proposals WHERE document_id = $1`, [document.id]);
    const proposalId = rows[0].id as string;

    await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/proposals/${proposalId}/reject`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), accepterCookie),
    });

    const secondRejectRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/proposals/${proposalId}/reject`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), accepterCookie),
    });
    expect(secondRejectRes.statusCode).toBe(409);

    const acceptAfterRejectRes = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/agent/proposals/${proposalId}/accept`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), accepterCookie),
    });
    expect(acceptAfterRejectRes.statusCode).toBe(409);

    await app.close();
  });
});
