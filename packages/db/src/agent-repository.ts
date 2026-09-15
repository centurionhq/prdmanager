/**
 * Agent conversation persistence (SDD-009 §Diseño/§Persistencia, WO-168) — tenant-scoped the same way
 * every other repository in `repositories.ts` is, plus a deliberately NOT tenant-scoped
 * {@link buildLlmGlobalUsageRepository} for the cross-org daily cutoff (see
 * `packages/db/src/schema/agent.ts`'s module doc comment for why that one table has no `org_id`/RLS at
 * all). Later WOs in this phase (169 tools, 171 loop, 172 endpoint, 173 propose_edit, 174 accept/reject,
 * 175 quotas) build their own logic on top of this thin CRUD layer rather than duplicating query shapes.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { agentConversations, agentMessages, agentProposals, llmGlobalUsage, llmUsage } from './schema/agent.js';
import { connect } from './pool.js';
import { withTenantTx } from './tenant.js';

export type AgentConversationRecord = typeof agentConversations.$inferSelect;
export type AgentMessageRecord = typeof agentMessages.$inferSelect;
export type AgentProposalRecord = typeof agentProposals.$inferSelect;
export type LlmUsageRecord = typeof llmUsage.$inferSelect;
export type LlmGlobalUsageRecord = typeof llmGlobalUsage.$inferSelect;

export interface CreateConversationInput {
  documentId: string;
  ownerId: string;
}

export interface AppendMessageInput {
  conversationId: string;
  role: AgentMessageRecord['role'];
  content: string;
  toolCalls?: unknown;
  toolCallId?: string | null;
  toolName?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  model?: string | null;
}

export interface CreateProposalInput {
  conversationId: string;
  documentId: string;
  summary: string;
  /** WO-173 defines the precise shape; stored as-is here (see the schema's own doc comment). */
  edits: unknown;
  fieldsSet?: Record<string, string> | null;
  fieldsUnset?: string[] | null;
  requestedBy: string;
}

export interface AgentConversationsRepository {
  create(input: CreateConversationInput): Promise<AgentConversationRecord>;
  findById(id: string): Promise<AgentConversationRecord | null>;
  /** SDD-009 §Diseño: "cada conversación es por documento y visible solo para su dueño" — the lookup a
   * route uses to find (or decide it must create) *this* caller's own conversation for a document. */
  findForDocumentAndOwner(documentId: string, ownerId: string): Promise<AgentConversationRecord | null>;
  /** Bumps `updated_at` to now — called whenever a new message/proposal is recorded, so a conversation
   * list can sort by recency without a join. */
  touch(id: string): Promise<void>;
}

export interface AgentMessagesRepository {
  append(input: AppendMessageInput): Promise<AgentMessageRecord>;
  /** Ascending by `createdAt` (oldest first), capped to the most recent `limit` messages (default
   * {@link DEFAULT_MESSAGE_HISTORY_LIMIT}) — WO-254: the agent loop only ever resends the last
   * `DEFAULT_MAX_HISTORY_MESSAGES` (40, `agent-loop.ts`) to the model, and the chat panel only ever
   * renders recent history on mount, so fetching a conversation's entire unbounded transcript from
   * Postgres on every turn and every page load was pure waste that grows with conversation length. */
  listForConversation(conversationId: string, limit?: number): Promise<AgentMessageRecord[]>;
}

/** WO-254: generous relative to `agent-loop.ts`'s `DEFAULT_MAX_HISTORY_MESSAGES` (40) so the chat panel's
 * own restore-on-mount view isn't needlessly truncated tighter than what the model itself gets. */
export const DEFAULT_MESSAGE_HISTORY_LIMIT = 100;

export interface AgentProposalsRepository {
  create(input: CreateProposalInput): Promise<AgentProposalRecord>;
  findById(id: string): Promise<AgentProposalRecord | null>;
  listForConversation(conversationId: string): Promise<AgentProposalRecord[]>;
  /** `null` when `id` doesn't exist or isn't `pending` (a caller re-accepting/rejecting an already-decided
   * proposal is treated as "nothing to do", never a silent overwrite of who/when first decided it). */
  markAccepted(id: string, respondedBy: string): Promise<AgentProposalRecord | null>;
  markRejected(id: string, respondedBy: string): Promise<AgentProposalRecord | null>;
  markStale(id: string): Promise<AgentProposalRecord | null>;
  /** Unconditional (no `WHERE status = 'pending'` guard) — only ever safe to call from the accept flow's
   * own rollback branch, after it has already atomically claimed `id` via {@link markAccepted} (WO-174:
   * a last-instant staleness check, done inside the direct-connection transaction, can still find the
   * document changed out from under an already-claimed proposal; reverting needs no ownership guard since
   * this caller already exclusively owns the row). Clears `respondedBy`/`respondedAt` back to unset —
   * "stale" has no responder, unlike "accepted"/"rejected". */
  forceStale(id: string): Promise<void>;
}

export interface LlmUsageRepository {
  /** Read-only: the one atomic write to this table is `packages/server/src/agent/agent-quota.ts`'s own
   * `reserveAgentTokens`/`reconcileAgentTokens` raw-SQL upsert (WO-175's quota reservation must stay
   * inside one `withTenantTx` alongside `llm_global_usage`'s equally atomic upsert, which has no RLS to
   * route through a tenant-scoped repository at all) — WO-255 removed this repository's own `increment`,
   * which duplicated that exact upsert with no production caller and no compiler-enforced link to the
   * real one if the schema ever changed. */
  find(usageDate: string): Promise<LlmUsageRecord | null>;
}

export interface AgentRepositories {
  conversations: AgentConversationsRepository;
  messages: AgentMessagesRepository;
  proposals: AgentProposalsRepository;
  llmUsage: LlmUsageRepository;
}

export function buildAgentRepositories(pool: Pool, orgId: string): AgentRepositories {
  return {
    conversations: {
      create: (input) =>
        withTenantTx(pool, orgId, async (tx) => {
          const [row] = await tx.insert(agentConversations).values({ orgId, documentId: input.documentId, ownerId: input.ownerId }).returning();
          if (!row) throw new Error(`failed to create agent conversation for document ${input.documentId}`);
          return row;
        }),
      findById: (id) => withTenantTx(pool, orgId, async (tx) => (await tx.select().from(agentConversations).where(eq(agentConversations.id, id)))[0] ?? null),
      findForDocumentAndOwner: (documentId, ownerId) =>
        withTenantTx(
          pool,
          orgId,
          async (tx) =>
            (await tx.select().from(agentConversations).where(and(eq(agentConversations.documentId, documentId), eq(agentConversations.ownerId, ownerId))))[0] ?? null,
        ),
      touch: (id) =>
        withTenantTx(pool, orgId, async (tx) => {
          await tx.update(agentConversations).set({ updatedAt: new Date() }).where(eq(agentConversations.id, id));
        }),
    },

    messages: {
      append: (input) =>
        withTenantTx(pool, orgId, async (tx) => {
          const [row] = await tx
            .insert(agentMessages)
            .values({
              orgId,
              conversationId: input.conversationId,
              role: input.role,
              content: input.content,
              toolCalls: input.toolCalls ?? null,
              toolCallId: input.toolCallId ?? null,
              toolName: input.toolName ?? null,
              promptTokens: input.promptTokens ?? null,
              completionTokens: input.completionTokens ?? null,
              totalTokens: input.totalTokens ?? null,
              model: input.model ?? null,
            })
            .returning();
          if (!row) throw new Error(`failed to append agent message to conversation ${input.conversationId}`);
          return row;
        }),
      listForConversation: (conversationId, limit = DEFAULT_MESSAGE_HISTORY_LIMIT) =>
        withTenantTx(pool, orgId, async (tx) => {
          const rows = await tx
            .select()
            .from(agentMessages)
            .where(eq(agentMessages.conversationId, conversationId))
            .orderBy(desc(agentMessages.createdAt))
            .limit(limit);
          return rows.reverse();
        }),
    },

    proposals: {
      create: (input) =>
        withTenantTx(pool, orgId, async (tx) => {
          const [row] = await tx
            .insert(agentProposals)
            .values({
              orgId,
              conversationId: input.conversationId,
              documentId: input.documentId,
              summary: input.summary,
              edits: input.edits,
              fieldsSet: input.fieldsSet ?? null,
              fieldsUnset: input.fieldsUnset ?? null,
              requestedBy: input.requestedBy,
            })
            .returning();
          if (!row) throw new Error(`failed to create agent proposal for conversation ${input.conversationId}`);
          return row;
        }),
      findById: (id) => withTenantTx(pool, orgId, async (tx) => (await tx.select().from(agentProposals).where(eq(agentProposals.id, id)))[0] ?? null),
      listForConversation: (conversationId) =>
        withTenantTx(pool, orgId, (tx) => tx.select().from(agentProposals).where(eq(agentProposals.conversationId, conversationId)).orderBy(desc(agentProposals.createdAt))),
      markAccepted: (id, respondedBy) =>
        withTenantTx(pool, orgId, async (tx) => {
          const [row] = await tx
            .update(agentProposals)
            .set({ status: 'accepted', respondedBy, respondedAt: new Date() })
            .where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
            .returning();
          return row ?? null;
        }),
      markRejected: (id, respondedBy) =>
        withTenantTx(pool, orgId, async (tx) => {
          const [row] = await tx
            .update(agentProposals)
            .set({ status: 'rejected', respondedBy, respondedAt: new Date() })
            .where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
            .returning();
          return row ?? null;
        }),
      markStale: (id) =>
        withTenantTx(pool, orgId, async (tx) => {
          const [row] = await tx.update(agentProposals).set({ status: 'stale' }).where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending'))).returning();
          return row ?? null;
        }),
      forceStale: (id) =>
        withTenantTx(pool, orgId, async (tx) => {
          await tx.update(agentProposals).set({ status: 'stale', respondedBy: null, respondedAt: null }).where(eq(agentProposals.id, id));
        }),
    },

    llmUsage: {
      find: (usageDate) => withTenantTx(pool, orgId, async (tx) => (await tx.select().from(llmUsage).where(and(eq(llmUsage.orgId, orgId), eq(llmUsage.usageDate, usageDate))))[0] ?? null),
    },
  };
}

/** Deliberately NOT tenant-scoped (no `withTenantTx`, no `org_id`) — see `./schema/agent.ts`'s module doc
 * comment for why `llm_global_usage` is a platform-level counter, not tenant data. Takes the raw `Pool`
 * (always `prdm_app` in production, same as every other repository) directly. */
export interface LlmGlobalUsageRepository {
  /** Read-only, same reasoning as {@link LlmUsageRepository} above: `agent-quota.ts`'s raw-SQL upsert is
   * the one real writer. */
  find(usageDate: string): Promise<LlmGlobalUsageRecord | null>;
}

export function buildLlmGlobalUsageRepository(pool: Pool): LlmGlobalUsageRepository {
  const db = connect(pool);
  return {
    find: async (usageDate) => (await db.select().from(llmGlobalUsage).where(eq(llmGlobalUsage.usageDate, usageDate)))[0] ?? null,
  };
}
