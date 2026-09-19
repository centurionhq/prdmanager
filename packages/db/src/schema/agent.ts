/**
 * Agent conversation persistence (SDD-009 §Diseño/§Persistencia, WO-168): `agent_conversations` (one per
 * document, private to whoever started it), `agent_messages` (the full transcript, tool calls included),
 * `agent_proposals` (`propose_edit` outputs — pending until a human accepts/rejects, WO-173/174) and the
 * two token-usage counters the quota system (WO-175) reserves against.
 *
 * Same composite-FK-into-a-parent/RLS/tenant-policy shape as every other tenant table in this package
 * (`doc-comments.ts` is the closest precedent: a document-scoped thread visible to a bounded audience) —
 * `agent_conversations` needs `UNIQUE (id, org_id)` since `agent_messages`/`agent_proposals` both carry a
 * composite FK into it one level deeper than `documents -> agent_conversations`.
 *
 * `llm_global_usage` is deliberately NOT org-scoped (no `org_id`, no RLS) and allowlisted in
 * `packages/db/tests/integration/catalog.test.ts` alongside `platform_admins`/`platform_audit_log`: the
 * global daily cutoff (SDD-009 "tope global diario con corte automático para proteger la clave
 * compartida") exists to protect one shared platform secret across every organization at once, which is
 * structurally a platform-level counter, not tenant data — no single organization's `org_id` could own a
 * cross-tenant total without breaking the exact tenant isolation RLS exists to enforce. It holds nothing
 * but a token/request count per day, no document content or identifiers.
 */
import { check, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization, user } from './auth.js';
import { documents } from './documents.js';

export const agentMessageRole = pgEnum('agent_message_role', ['system', 'user', 'assistant', 'tool']);
export const agentProposalStatus = pgEnum('agent_proposal_status', ['pending', 'accepted', 'rejected', 'stale']);

/** SDD-009 §Herramientas: tool outputs are capped ~20 KB; a message's own text content (a user's prompt,
 * or the model's own prose) is capped more generously since it isn't a tool result — comfortably above
 * any single tool output plus the model's own commentary about it. */
export const AGENT_MESSAGE_CONTENT_MAX_LENGTH = 64 * 1024;

export const agentConversations = pgTable(
  'agent_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    /** SDD-009 §Diseño: "cada conversación es por documento y visible solo para su dueño" — the user who
     * started it; never derived from `agent_messages.role = 'user'` rows, since visibility must hold even
     * before the first message is sent. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // Target of agent_messages'/agent_proposals' composite FK below.
    unique('agent_conversations_id_org_id_key').on(table.id, table.orgId),
    foreignKey({
      columns: [table.documentId, table.orgId],
      foreignColumns: [documents.id, documents.orgId],
      name: 'agent_conversations_document_org_fk',
    }),
    index('agent_conversations_org_id_idx').on(table.orgId),
    index('agent_conversations_document_id_idx').on(table.documentId),
    index('agent_conversations_owner_id_idx').on(table.ownerId),
  ],
);

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    role: agentMessageRole('role').notNull(),
    content: text('content').notNull(),
    /** `LlmToolCall[]` (`packages/server/src/agent/llm-client.ts`) as-is — only ever set on an `assistant`
     * message that requested one or more tool calls. */
    toolCalls: jsonb('tool_calls'),
    /** Only set on a `role: 'tool'` message — which call this is the result of, and its own tool name
     * mirrored back (OpenAI/DeepSeek both require both on the result message). */
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    /** Only set on an `assistant` message — which model actually produced it (SDD-009: "agent_messages
     * (rol, contenido, tool calls, tokens, modelo)"). */
    model: text('model'),
    /** WO-468 (SDD-035/PRD-016): the transcript's real order, because `created_at` cannot carry it.
     * `defaultNow()` is the *transaction* timestamp and `appendMany` writes a whole turn in one batched
     * INSERT, so every message a turn produced lands on the identical `created_at` (verified: the 8
     * messages of one real turn all read `2026-09-19T00:10:42.282Z`). Ordering by a column with ties is
     * ordering by nothing — and `documents-agent.ts` replays that same ordering back to the model, so a
     * `tool` result could precede the `assistant` that requested it. Monotonic per conversation, assigned
     * server-side inside the insert's own transaction. `created_at` stays: it answers "when", not "in
     * what order". */
    seq: integer('seq').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.orgId],
      foreignColumns: [agentConversations.id, agentConversations.orgId],
      name: 'agent_messages_conversation_org_fk',
    }),
    index('agent_messages_org_id_idx').on(table.orgId),
    index('agent_messages_conversation_id_idx').on(table.conversationId),
    unique('agent_messages_conversation_seq_uq').on(table.conversationId, table.seq),
    check('agent_messages_content_length', sql`char_length(${table.content}) <= ${AGENT_MESSAGE_CONTENT_MAX_LENGTH}`),
  ],
);

export const agentProposals = pgTable(
  'agent_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    documentId: uuid('document_id').notNull(),
    status: agentProposalStatus('status').notNull().default('pending'),
    summary: text('summary').notNull(),
    /** `{expectedText, occurrence, replacement, anchorStart, anchorEnd}[]` — `anchorStart`/`anchorEnd` are
     * base64-encoded `Y.encodeRelativePosition(...)` bytes (WO-173), stored inside the jsonb blob rather
     * than a parallel `bytea[]` column since a proposal is read/written as one atomic unit, never queried
     * by an individual edit's anchor. */
    edits: jsonb('edits').notNull(),
    fieldsSet: jsonb('fields_set'),
    fieldsUnset: jsonb('fields_unset'),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => user.id),
    respondedBy: text('responded_by').references(() => user.id),
    respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.orgId],
      foreignColumns: [agentConversations.id, agentConversations.orgId],
      name: 'agent_proposals_conversation_org_fk',
    }),
    foreignKey({
      columns: [table.documentId, table.orgId],
      foreignColumns: [documents.id, documents.orgId],
      name: 'agent_proposals_document_org_fk',
    }),
    index('agent_proposals_org_id_idx').on(table.orgId),
    index('agent_proposals_conversation_id_idx').on(table.conversationId),
    index('agent_proposals_document_id_idx').on(table.documentId),
  ],
);

/** Per-organization, per-day token/request counters (SDD-009 §Seguridad y costo: "tope diario de tokens y
 * requests por organización") — `(org_id, usage_date)` primary key so a reservation is a single upsert. */
export const llmUsage = pgTable(
  'llm_usage',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    usageDate: date('usage_date', { mode: 'string' }).notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    requestCount: integer('request_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.usageDate], name: 'llm_usage_pkey' }), index('llm_usage_org_id_idx').on(table.orgId)],
);

/** See the module doc comment: deliberately global, no `org_id`, no RLS — allowlisted in the catalog test
 * the same way `platform_admins`/`platform_audit_log` are. */
export const llmGlobalUsage = pgTable('llm_global_usage', {
  usageDate: date('usage_date', { mode: 'string' }).primaryKey(),
  totalTokens: integer('total_tokens').notNull().default(0),
  requestCount: integer('request_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
