/**
 * `doc_comment_threads`/`doc_comments` (SDD-008 §"Validación en vivo, versiones y comentarios", WO-158):
 * threads anchored on the collaborative body via a `Y.RelativePosition` (encoded start/end, resolved
 * against the live `Y.Doc` server-side to recompute `quoted_text` and whether the anchor still exists —
 * "Si el texto anclado desaparece, el hilo queda 'sin ancla' pero visible").
 *
 * `doc_comment_threads.quotedText` is the snapshot taken at creation time — a fallback for a thread whose
 * anchor no longer resolves at all (deleted document, corrupted state); the live read path
 * (`packages/server/src/collab/comments.ts`) always prefers a freshly recomputed value from the current
 * `Y.Doc` and never writes that recomputation back to this column, so it's never a source of staleness
 * for a healthy anchor.
 *
 * Same composite-FK-into-`documents`/RLS/append-mostly-grant shape as `doc_updates`/`doc_client_bindings`
 * (WO-149/150): `doc_comment_threads` needs `UNIQUE (id, org_id)` since `doc_comments` carries its own
 * composite FK into it (one level deeper than `documents -> doc_updates`, same mechanism).
 *
 * Both tables get `SELECT, INSERT, UPDATE` (no `DELETE`): resolving/reopening a thread and "deleting" a
 * comment are both `UPDATE`s (`status`/`resolved_*`, `deleted_at` — soft delete, since a thread with a
 * deleted comment must stay visible per SDD-008, and hard-deleting would break `doc_comments.thread_id`'s
 * ordering/count for anyone still viewing the thread).
 */
import { check, foreignKey, index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization, user } from './auth.js';
import { bytea } from './custom-types.js';
import { documents } from './documents.js';

export const docThreadStatus = pgEnum('doc_thread_status', ['open', 'resolved']);

/** Max body size (SDD-008: "cuerpo ≤ 10KB"), in bytes/characters — comment bodies are plain text, so the
 * two coincide closely enough that a `char_length` check is the right unit for a human-facing limit.
 * Exported for `@prdm/contracts`'s zod schema to mirror by hand (same reasoning as every other
 * hand-synced limit in this codebase); the CHECK constraint below hardcodes the same number literally,
 * since DDL text has no parameter binding to interpolate a JS constant into. */
export const DOC_COMMENT_BODY_MAX_LENGTH = 10 * 1024;

export const docCommentThreads = pgTable(
  'doc_comment_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    /** `Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(body, index))` — survives
     * concurrent edits elsewhere in the document (SDD-008's own explicit test case), unlike a plain
     * character offset. */
    anchorStart: bytea('anchor_start').notNull(),
    anchorEnd: bytea('anchor_end').notNull(),
    /** Snapshot at creation time — see the module doc comment for why the live read path doesn't trust
     * this alone. */
    quotedText: text('quoted_text').notNull(),
    status: docThreadStatus('status').notNull().default('open'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    resolvedBy: text('resolved_by').references(() => user.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('doc_comment_threads_id_org_id_key').on(table.id, table.orgId),
    foreignKey({
      columns: [table.documentId, table.orgId],
      foreignColumns: [documents.id, documents.orgId],
      name: 'doc_comment_threads_document_org_fk',
    }),
    index('doc_comment_threads_org_id_idx').on(table.orgId),
    index('doc_comment_threads_document_id_idx').on(table.documentId),
  ],
);

export const docComments = pgTable(
  'doc_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
    /** Soft delete (SDD-008: a thread must stay visible even once a comment in it is "deleted") — never
     * a real `DELETE`, enforced at the grant level below. */
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    foreignKey({
      columns: [table.threadId, table.orgId],
      foreignColumns: [docCommentThreads.id, docCommentThreads.orgId],
      name: 'doc_comments_thread_org_fk',
    }),
    index('doc_comments_org_id_idx').on(table.orgId),
    index('doc_comments_thread_id_idx').on(table.threadId),
    check('doc_comments_body_length', sql`char_length(${table.body}) <= 10240`),
    // Rejects C0 control characters and DEL, but allows \t/\n/\r — a comment is reasonably multi-line.
    // `E'...'` + `\\xHH` (not a bare `'...'` with a JS-level `\u00xx` escape, which `drizzle-kit generate`
    // would bake into the migration file as a raw, unprintable control byte instead of a Postgres regex
    // escape sequence — caught by inspecting the generated 0011 migration's actual bytes before this).
    // Starts at `\x01`, not `\x00`: a `text` value can never contain an embedded NUL byte in Postgres at
    // all (any input containing one is rejected at the protocol level before a CHECK constraint would
    // ever run), so `\x00` in this range would only ever break constructing the pattern itself.
    check('doc_comments_body_no_control_chars', sql`${table.body} !~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'`),
  ],
);
