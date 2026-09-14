/**
 * `doc_updates` (SDD-008 §"Autoría por línea no falsificable" / §"Servidor de tiempo real", WO-145/
 * WO-149): the durable, append-only log of every Yjs update a collaborative document's Hocuspocus
 * instance has accepted, written **before** it is broadcast to other connections. Two consumers:
 *
 * - Replay at load time (WO-145): `documents.snapshotSeq` records the `doc_updates.seq` up to which
 *   `documents.workingState` already reflects (i.e. the snapshot was taken right after that row was
 *   written); `onLoadDocument` replays every row with `seq > snapshotSeq` on top of the decoded
 *   snapshot, so a debounced-but-not-yet-flushed tail of updates is never silently lost between two
 *   `onStoreDocument` runs (or across a server restart).
 * - Attribution/blame (WO-149/WO-150, a later batch's blame computation): `actorKind`/`userId`/
 *   `onBehalfOf`/`agentId` identify who produced the update; `structRanges`/`deleteRanges` are the
 *   `(client, clock, len)` ranges this update inserted/deleted, computed from `Y.decodeUpdate` — kept
 *   as `jsonb` rather than re-decoding `update` on every blame query.
 *
 * `actorKind`/`userId` are nullable at the database level even though WO-149's application code always
 * populates them for every row it writes: WO-145 (this migration) creates the table before anything
 * writes to it, and a `NOT NULL` constraint a later migration would have to loosen for some edge case
 * is far more costly than one a later WO's application code simply never leaves null in practice.
 *
 * RLS (SDD-006 §Aislamiento por capas): `org_id NOT NULL`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, same
 * `NULLIF` tenant policy as every other tenant table — even though no route in this batch ever lets an
 * HTTP caller read this table directly, Hocuspocus's own persistence/hooks run through the same
 * `prdm_app` pool as everything else, so the same defense-in-depth applies. Append-only: `prdm_app`
 * gets `SELECT, INSERT` only (mirrors `audit_log`'s grant), never `UPDATE`/`DELETE` — a rejected/replayed
 * update is a new row, not a mutation of an old one.
 */
import { foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { bytea } from './custom-types.js';
import { documents } from './documents.js';

/** `user`: a real, authenticated better-auth session. `agent`: an AI agent acting on behalf of a user
 * (`onBehalfOf`/`agentId` set). `system`: a server-attributed transaction with no human behind it
 * (`system:import`, `system:engine`, a version restore's own diff-apply step). */
export const docUpdateActorKind = pgEnum('doc_update_actor_kind', ['user', 'agent', 'system']);

export const docUpdates = pgTable(
  'doc_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    /** Monotonically increasing per `documentId`, allocated by the writer (WO-149) inside the same
     * transaction as the insert — never a bare `bigserial`, which would be monotonic per-table, not
     * per-document. */
    seq: integer('seq').notNull(),
    actorKind: docUpdateActorKind('actor_kind'),
    userId: text('user_id').references(() => user.id),
    /** Set only when `actorKind = 'agent'`: which user the agent acted on behalf of. */
    onBehalfOf: text('on_behalf_of').references(() => user.id),
    /** Set only when `actorKind = 'agent'`: which agent (e.g. `"deepseek"`). */
    agentId: text('agent_id'),
    /** Hocuspocus's own per-socket connection identifier; `null` for a server-attributed transaction
     * with no live connection behind it (`openDirectConnection`). */
    connectionId: text('connection_id'),
    update: bytea('update').notNull(),
    structRanges: jsonb('struct_ranges').notNull().default([]),
    deleteRanges: jsonb('delete_ranges').notNull().default([]),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('doc_updates_document_id_seq_key').on(table.documentId, table.seq),
    foreignKey({
      columns: [table.documentId, table.orgId],
      foreignColumns: [documents.id, documents.orgId],
      name: 'doc_updates_document_org_fk',
    }),
    index('doc_updates_org_id_idx').on(table.orgId),
    index('doc_updates_document_id_idx').on(table.documentId),
  ],
);
