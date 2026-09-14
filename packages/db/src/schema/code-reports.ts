/**
 * `code_reports` (SDD-010 "Sync de developers y drift", WO-180/WO-181): the idempotency ledger for
 * `POST /api/v1/projects/:graphProjectId/code-reports` — `UNIQUE (project_id, token_id,
 * idempotency_key)` is the actual concurrency-safety mechanism (SDD-010: "misma clave con otro cuerpo
 * -> 422 idempotency_mismatch"), not any application-level locking: two concurrent requests racing the
 * same key both attempt the same `INSERT ... ON CONFLICT DO NOTHING`, Postgres's own unique-index row
 * lock serializes them, and the loser's follow-up `SELECT` (same transaction) only ever observes the
 * winner's *fully committed* row — see `packages/db/src/code-reports-repository.ts`'s own doc comment
 * for why `result`/`mode`/`head_sha` are written together with the reservation in one INSERT rather
 * than a two-phase reserve-then-update (which would expose a "pending" window to the loser).
 *
 * `body_sha256` is the sha256 of the exact raw request bytes (never a re-serialization of the parsed
 * JSON, which could hash two semantically-identical-but-differently-ordered bodies differently in
 * either direction) — the actual thing "same key + different body" compares.
 */
import { foreignKey, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { apiTokens } from './tokens.js';
import { projects } from './projects.js';

export const codeReportMode = pgEnum('code_report_mode', ['baseline', 'preview']);

export const codeReports = pgTable(
  'code_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    orgId: text('org_id').notNull(),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    bodySha256: text('body_sha256').notNull(),
    mode: codeReportMode('mode').notNull(),
    headSha: text('head_sha').notNull(),
    /** The full `codeReportResponseSchema`-shaped response returned the first time, replayed verbatim
     * on a legitimate retry. */
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('code_reports_project_token_idempotency_key').on(table.projectId, table.tokenId, table.idempotencyKey),
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'code_reports_project_org_fk',
    }),
    index('code_reports_org_id_idx').on(table.orgId),
  ],
);
