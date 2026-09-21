/**
 * Agent conversation persistence (SDD-009 §Diseño/§Persistencia, WO-168) — tenant-scoped the same way
 * every other repository in `repositories.ts` is, plus a deliberately NOT tenant-scoped
 * {@link buildLlmGlobalUsageRepository} for the cross-org daily cutoff (see
 * `packages/db/src/schema/agent.ts`'s module doc comment for why that one table has no `org_id`/RLS at
 * all). Later WOs in this phase (169 tools, 171 loop, 172 endpoint, 173 propose_edit, 174 accept/reject,
 * 175 quotas) build their own logic on top of this thin CRUD layer rather than duplicating query shapes.
 */
import { and, desc, eq, max } from 'drizzle-orm';
import type { Pool } from 'pg';
import { agentConversations, agentMessages, agentProposals, llmGlobalUsage, llmUsage } from './schema/agent.js';
import { connect, type PgDatabase } from './pool.js';
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
  /** WO-492 (SDD-040): only meaningful on a `role: 'tool'` message — whether that tool call succeeded. */
  toolOk?: boolean | null;
  /** WO-493 (SDD-040): only set on the last message of a turn — how that turn ended. */
  finishReason?: string | null;
}

export interface CreateProposalInput {
  conversationId: string;
  documentId: string;
  summary: string;
  /** WO-173 defines the precise shape; stored as-is here (see the schema's own doc comment). */
  edits: unknown;
  /** WO-537 (SDD-050): a field's value may be a list (`tags`, `implements`, ...), not only a string —
   * this stores whatever `propose_edit` already validated, as-is, into the opaque `jsonb` column below. */
  fieldsSet?: Record<string, string | number | boolean | string[]> | null;
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
  /** WO-256: one batched insert instead of one `append` per message — `documents-agent.ts` persists every
   * message a turn produced (assistant + tool results, up to a few per loop iteration) in a single call
   * once the turn finishes, rather than a sequential `for` loop of individually-awaited inserts. Returns
   * `[]` for an empty `inputs` without issuing any query. */
  appendMany(inputs: readonly AppendMessageInput[]): Promise<AgentMessageRecord[]>;
  /** Ascending by `seq` (oldest first), capped to the most recent `limit` messages (default
   * {@link DEFAULT_MESSAGE_HISTORY_LIMIT}) — WO-254: the agent loop only ever resends the last
   * `DEFAULT_MAX_HISTORY_MESSAGES` (40, `agent-loop.ts`) to the model, and the chat panel only ever
   * renders recent history on mount, so fetching a conversation's entire unbounded transcript from
   * Postgres on every turn and every page load was pure waste that grows with conversation length.
   *
   * WO-469 (SDD-035): ordered by `seq`, never by `createdAt`. A whole turn shares one `createdAt` (it is
   * written in a single batched insert, and `defaultNow()` is the transaction clock), so ordering by it
   * left the order *within* a turn up to Postgres. That surfaced as a scrambled transcript, and, because
   * `documents-agent.ts` replays this exact list back to the model, as a scrambled history too. */
  listForConversation(conversationId: string, limit?: number | null): Promise<AgentMessageRecord[]>;
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

/** WO-469 (SDD-035): the next free position in a conversation, read inside the caller's own transaction.
 * `max + 1` rather than a sequence because `seq` is per conversation, not global, and because a gap left
 * by a rolled-back turn would make a global sequence's numbers non-contiguous for no benefit. */
async function nextSeq(tx: PgDatabase, conversationId: string): Promise<number> {
  const [row] = await tx
    .select({ max: max(agentMessages.seq) })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId));
  return (row?.max ?? 0) + 1;
}

/** Shared by `append` and `appendMany` so the two never drift on which `AppendMessageInput` fields map to
 * which column/default. */
function toAgentMessageValues(orgId: string, input: AppendMessageInput, seq: number) {
  return {
    orgId,
    seq,
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
    toolOk: input.toolOk ?? null,
    finishReason: input.finishReason ?? null,
  };
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
          const seq = await nextSeq(tx, input.conversationId);
          const [row] = await tx.insert(agentMessages).values(toAgentMessageValues(orgId, input, seq)).returning();
          if (!row) throw new Error(`failed to append agent message to conversation ${input.conversationId}`);
          return row;
        }),
      appendMany: (inputs) => {
        if (inputs.length === 0) return Promise.resolve([]);
        return withTenantTx(pool, orgId, async (tx) => {
          // WO-469: `inputs` is one turn, in the order the loop produced it, and it stays that way --
          // this is the whole point of `seq`. Read once and count up, inside the same transaction as the
          // insert, so a concurrent turn on the same conversation either serializes behind this one or
          // trips `agent_messages_conversation_seq_uq` rather than silently duplicating a position.
          const first = await nextSeq(tx, inputs[0]!.conversationId);
          return tx
            .insert(agentMessages)
            .values(inputs.map((input, index) => toAgentMessageValues(orgId, input, first + index)))
            .returning();
        });
      },
      listForConversation: (conversationId, limit = DEFAULT_MESSAGE_HISTORY_LIMIT) =>
        withTenantTx(pool, orgId, async (tx) => {
          // WO-506 (SDD-042/FB-023): `null` means the whole conversation. The product owner's rule is
          // "context stays at the last 40 messages, but the chat itself has no limit" -- two different
          // caps that used to be conflated here. The resend budget lives in `agent-loop.ts`; this one
          // only ever governed what a reader is shown, and silently hiding the oldest messages is not a
          // thing a chat should do.
          const base = tx.select().from(agentMessages).where(eq(agentMessages.conversationId, conversationId)).orderBy(desc(agentMessages.seq));
          const rows = limit === null ? await base : await base.limit(limit);
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
