/**
 * `agent_conversations`/`agent_messages`/`agent_proposals`/`llm_usage`/`llm_global_usage` (SDD-009
 * §Persistencia, WO-168): repository CRUD plus RLS tenant isolation between two organizations. The
 * exhaustive "every non-allowlisted table has org_id/RLS/composite FK" sweep lives in `catalog.test.ts` —
 * this file exercises the actual repository behavior on top.
 */
import { randomUUID } from 'node:crypto';
import { buildLlmGlobalUsageRepository, createTenantDb } from '@prdm/db';
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
