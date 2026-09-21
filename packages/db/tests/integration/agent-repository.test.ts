/**
 * `agent_conversations`/`agent_messages`/`agent_proposals`/`llm_usage`/`llm_global_usage` (SDD-009
 * §Persistencia, WO-168): repository CRUD plus RLS tenant isolation between two organizations. The
 * exhaustive "every non-allowlisted table has org_id/RLS/composite FK" sweep lives in `catalog.test.ts` —
 * this file exercises the actual repository behavior on top.
 */
import { randomUUID } from 'node:crypto';
import { buildLlmGlobalUsageRepository, createTenantDb, DEFAULT_MESSAGE_HISTORY_LIMIT } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

/** WO-255: `LlmUsageRepository`/`LlmGlobalUsageRepository` dropped their own `increment` (dead in
 * production — `packages/server/src/agent/agent-quota.ts`'s raw-SQL upsert is the one real writer), so
 * these tests now seed state with the exact same upsert shape directly, then verify through the
 * repository's still-real `find`. */
async function seedLlmUsage(pool: Pool, orgId: string, usageDate: string, deltaTokens: number, deltaRequests: number): Promise<void> {
  await pool.query(
    `INSERT INTO llm_usage (org_id, usage_date, total_tokens, request_count)
     VALUES ($1, $2::date, $3, $4)
     ON CONFLICT (org_id, usage_date) DO UPDATE SET total_tokens = llm_usage.total_tokens + $3, request_count = llm_usage.request_count + $4, updated_at = now()`,
    [orgId, usageDate, deltaTokens, deltaRequests],
  );
}

async function seedLlmGlobalUsage(pool: Pool, usageDate: string, deltaTokens: number, deltaRequests: number): Promise<void> {
  await pool.query(
    `INSERT INTO llm_global_usage (usage_date, total_tokens, request_count)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (usage_date) DO UPDATE SET total_tokens = llm_global_usage.total_tokens + $2, request_count = llm_global_usage.request_count + $3, updated_at = now()`,
    [usageDate, deltaTokens, deltaRequests],
  );
}

async function insertDocumentFixture(pool: Pool, overrides: { orgId: string; projectId: string }): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
     VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', 'collab', 'draft')`,
    [id, overrides.orgId, overrides.projectId, `PRD-${id.slice(0, 8)}`],
  );
  return id;
}

describe('agent repositories (SDD-009, WO-168)', () => {
  test('creates a conversation, appends messages and lists them in order', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const owner = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const conversation = await db.agent.conversations.create({ documentId, ownerId: owner.id });
    expect(conversation.documentId).toBe(documentId);
    expect(conversation.ownerId).toBe(owner.id);

    await db.agent.messages.append({ conversationId: conversation.id, role: 'user', content: 'edit the intro' });
    await db.agent.messages.append({
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'read_document', argumentsJson: '{}' }],
      model: 'deepseek-v4-flash',
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    await db.agent.messages.append({ conversationId: conversation.id, role: 'tool', content: '{"body":"..."}', toolCallId: 'call_1', toolName: 'read_document' });

    const messages = await db.agent.messages.listForConversation(conversation.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(messages[1]?.toolCalls).toEqual([{ id: 'call_1', name: 'read_document', argumentsJson: '{}' }]);
    expect(messages[2]?.toolCallId).toBe('call_1');
  });

  test('WO-469 (SDD-035/PRD-016): a whole turn written by one appendMany reads back in the order the loop produced it, even though every row shares one createdAt', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const owner = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);
    const conversation = await db.agent.conversations.create({ documentId, ownerId: owner.id });

    await db.agent.messages.append({ conversationId: conversation.id, role: 'user', content: 'what is this document about?' });

    // The exact shape of a real turn: the assistant's preamble, the call it made, its result, and so on,
    // ending in the prose answer. This is what got scrambled in production -- the final summary read back
    // *before* the tool results that produced it, and the preamble read back last.
    const turn = [
      { role: 'assistant' as const, content: "I'll read the document first.", toolCalls: [{ id: 'call_1', name: 'read_document', argumentsJson: '{}' }] },
      { role: 'tool' as const, content: '{"body":"..."}', toolCallId: 'call_1', toolName: 'read_document' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_2', name: 'search_project', argumentsJson: '{"q":"arbol"}' }] },
      { role: 'tool' as const, content: '{"nodes":[]}', toolCallId: 'call_2', toolName: 'search_project' },
      { role: 'assistant' as const, content: 'It is PRD-013, and it is closed.' },
    ];
    await db.agent.messages.appendMany(turn.map((message) => ({ conversationId: conversation.id, ...message })));

    const messages = await db.agent.messages.listForConversation(conversation.id);
    expect(messages.map((m) => m.content)).toEqual([
      'what is this document about?',
      "I'll read the document first.",
      '{"body":"..."}',
      '',
      '{"nodes":[]}',
      'It is PRD-013, and it is closed.',
    ]);
    // Contiguous from 1, so "the most recent `limit`" really is a suffix of the transcript.
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);

    // The reason `seq` has to exist at all: ordering by `createdAt` is ordering by a constant here.
    const turnTimestamps = new Set(messages.slice(1).map((m) => m.createdAt.toISOString()));
    expect(turnTimestamps.size).toBe(1);

    // A later turn keeps counting rather than restarting or colliding.
    await db.agent.messages.append({ conversationId: conversation.id, role: 'user', content: 'summarise it' });
    const afterSecondTurn = await db.agent.messages.listForConversation(conversation.id);
    expect(afterSecondTurn.at(-1)?.seq).toBe(7);
    expect(afterSecondTurn.at(-1)?.content).toBe('summarise it');
  });

  test('WO-469: seq is per conversation, so two conversations both start at 1 without colliding', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const owner = await createUserFixture(pg);
    const other = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const first = await db.agent.conversations.create({ documentId, ownerId: owner.id });
    const second = await db.agent.conversations.create({ documentId, ownerId: other.id });

    await db.agent.messages.append({ conversationId: first.id, role: 'user', content: 'a' });
    await db.agent.messages.append({ conversationId: second.id, role: 'user', content: 'b' });
    await db.agent.messages.append({ conversationId: first.id, role: 'user', content: 'c' });

    expect((await db.agent.messages.listForConversation(first.id)).map((m) => m.seq)).toEqual([1, 2]);
    expect((await db.agent.messages.listForConversation(second.id)).map((m) => m.seq)).toEqual([1]);
  });

  test('WO-506 (SDD-042/FB-023): a conversation longer than the default cap reads back whole when no limit is asked for', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const owner = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);
    const conversation = await db.agent.conversations.create({ documentId, ownerId: owner.id });

    // Comfortably past DEFAULT_MESSAGE_HISTORY_LIMIT (100), which used to silently drop the oldest.
    const total = 130;
    await db.agent.messages.appendMany(Array.from({ length: total }, (_, i) => ({ conversationId: conversation.id, role: 'user' as const, content: `mensaje ${i}` })));

    // The product rule: the model's context stays bounded, the chat itself does not.
    const capped = await db.agent.messages.listForConversation(conversation.id);
    expect(capped).toHaveLength(DEFAULT_MESSAGE_HISTORY_LIMIT);

    const whole = await db.agent.messages.listForConversation(conversation.id, null);
    expect(whole).toHaveLength(total);
    expect(whole[0]?.content).toBe('mensaje 0');
    expect(whole.at(-1)?.content).toBe(`mensaje ${total - 1}`);
  });

  test('findForDocumentAndOwner only ever finds the caller’s own conversation for that document', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const owner = await createUserFixture(pg);
    const other = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const conversation = await db.agent.conversations.create({ documentId, ownerId: owner.id });

    expect(await db.agent.conversations.findForDocumentAndOwner(documentId, owner.id)).toEqual(conversation);
    expect(await db.agent.conversations.findForDocumentAndOwner(documentId, other.id)).toBeNull();
  });

  test('proposal lifecycle: pending -> accepted, and re-deciding an already-decided proposal is a no-op', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const owner = await createUserFixture(pg);
    const accepter = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const conversation = await db.agent.conversations.create({ documentId, ownerId: owner.id });
    const proposal = await db.agent.proposals.create({
      conversationId: conversation.id,
      documentId,
      summary: 'tighten the intro',
      edits: [{ expectedText: 'old', replacement: 'new' }],
      requestedBy: owner.id,
    });
    expect(proposal.status).toBe('pending');

    const accepted = await db.agent.proposals.markAccepted(proposal.id, accepter.id);
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.respondedBy).toBe(accepter.id);

    // Already accepted: a second accept/reject attempt is a no-op, never overwriting who first decided it.
    expect(await db.agent.proposals.markAccepted(proposal.id, owner.id)).toBeNull();
    expect(await db.agent.proposals.markRejected(proposal.id, owner.id)).toBeNull();
  });

  test('llm_usage increments are additive upserts per org and day', async () => {
    const org = await createOrganizationFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    await seedLlmUsage(pg.ownerPool, org.id, '2026-09-14', 100, 1);
    await seedLlmUsage(pg.ownerPool, org.id, '2026-09-14', 50, 1);
    const afterSecond = await db.agent.llmUsage.find('2026-09-14');
    expect(afterSecond?.totalTokens).toBe(150);
    expect(afterSecond?.requestCount).toBe(2);

    expect(await db.agent.llmUsage.find('2026-09-15')).toBeNull();
  });

  test('llm_usage is isolated per organization (RLS)', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    await seedLlmUsage(pg.ownerPool, orgA.id, '2026-09-14', 100, 1);

    const bUsage = await createTenantDb(pg.appPool).forOrg(orgB.id).agent.llmUsage.find('2026-09-14');
    expect(bUsage).toBeNull();
  });

  test('a conversation created in one org is invisible from another org (RLS)', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: orgA.id, projectId: projectA.id });
    const owner = await createUserFixture(pg);

    const conversation = await createTenantDb(pg.appPool).forOrg(orgA.id).agent.conversations.create({ documentId, ownerId: owner.id });

    expect(await createTenantDb(pg.appPool).forOrg(orgB.id).agent.conversations.findById(conversation.id)).toBeNull();
  });

  test('llm_global_usage aggregates across every organization and is not tenant-scoped', async () => {
    const global = buildLlmGlobalUsageRepository(pg.appPool);
    await seedLlmGlobalUsage(pg.ownerPool, '2026-09-14', 500, 2);
    await seedLlmGlobalUsage(pg.ownerPool, '2026-09-14', 250, 1);
    const after = await global.find('2026-09-14');
    expect(after?.totalTokens).toBe(750);
    expect(after?.requestCount).toBe(3);
  });
});
