/**
 * `doc_client_bindings` (SDD-008 §"Autoría por línea no falsificable", WO-149/WO-150): binds a Yjs
 * `client_id` to the actor who first used it on a given document — `(document_id, client_id)` is a
 * composite primary key, so a second attempt to bind an already-bound client id is a plain insert
 * conflict (`onConflictDoNothing`, first-writer-wins) rather than a read-then-write race. WO-150's
 * `beforeSync` anti-spoofing check reads this table to decide whether an incoming struct's client id
 * belongs to the connection presenting it; WO-149's `onChange` is the only writer, inserting a row the
 * first time it durably logs an update introducing a client id this document hasn't seen before.
 *
 * RLS (same `NULLIF` tenant policy as every other tenant table) and append-only grants (`SELECT,
 * INSERT` only — a binding is never reassigned or deleted once made, by design: a client id is either
 * still honestly owned by the same actor or the update gets rejected, never silently re-bound).
 */
import { foreignKey, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { docUpdateActorKind } from './doc-updates.js';
import { documents } from './documents.js';

export const docClientBindings = pgTable(
  'doc_client_bindings',
  {
    documentId: uuid('document_id').notNull(),
    /** Yjs client ids are 32-bit unsigned integers (`Math.random() * 2**32`, per `yjs`'s own
     * `createID`/`generateNewClientId`); stored as `text` rather than a numeric type only to sidestep
     * `pg`'s own `bigint -> string` driver mapping ambiguity elsewhere in this codebase — compared for
     * equality only, never arithmetic, so the column type has no functional downside. */
    clientId: text('client_id').notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    actorKind: docUpdateActorKind('actor_kind').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.clientId], name: 'doc_client_bindings_pkey' }),
    foreignKey({
      columns: [table.documentId, table.orgId],
      foreignColumns: [documents.id, documents.orgId],
      name: 'doc_client_bindings_document_org_fk',
    }),
    index('doc_client_bindings_org_id_idx').on(table.orgId),
  ],
);
