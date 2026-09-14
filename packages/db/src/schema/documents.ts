/**
 * `documents`, `document_versions`, `id_counters`, `project_baselines`, `commits` and `project_code_state`
 * (SDD-007 "Documentos y flujo" / "PgProjectEngine"; WO-130).
 *
 * Every table here is `org_id NOT NULL` with RLS enabled+forced and the same `NULLIF` tenant policy as
 * every other tenant table (hand-appended below drizzle-kit's own output, same shape as
 * `projects`/`api_tokens`); every project-scoped table carries a composite FK on `(project_id, org_id)`
 * into `projects(id, org_id)`, and `document_versions` carries one on `(document_id, org_id)` into
 * `documents(id, org_id)` (hence `documents` also needs `UNIQUE (id, org_id)`, mirroring `projects`' own
 * `projects_id_org_id_key`) — the same mechanism SDD-006 relies on for "a cross-org reference fails at
 * the FK", now extended one level deeper (project -> document).
 *
 * `documents.publishedVersionId` is a plain nullable uuid, deliberately WITHOUT a foreign key: it would
 * either have to be circular with `document_versions.document_id` (declared in the same file, resolvable
 * with drizzle's lazy `.references()`, but adding real referential-integrity risk for a field the server
 * only ever sets *after* the referenced version row already exists — SDD-007 "congela la versión y
 * dispara la proyección") or a forward reference to a not-yet-existing row during the very first publish.
 * Kept as a plain column instead; the invariant (points at an existing `document_versions` row once set)
 * is enforced by `PgProjectEngine`'s publish transaction, not the schema.
 *
 * `id_counters` and `project_baselines` are per-project singletons scoped by kind/PK respectively, not
 * append-only, hence `SELECT+INSERT+UPDATE`/full CRUD grants below rather than the append-only shape of
 * `audit_log`. `commits`/`project_code_state` get `SELECT+INSERT+UPDATE` (no `DELETE`): nothing in this
 * WO's scope (or SDD-010's CI-report ingestion, which owns writing `commits`) ever needs to delete a
 * commit or a project's code-state row; a future WO must extend the grant explicitly if that changes,
 * per SDD-006's "grant only what's actually used" convention.
 */
import { check, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organization, user } from './auth.js';
import { bytea } from './custom-types.js';
import { apiTokens } from './tokens.js';
import { projects } from './projects.js';

/** Mirrors `@prdm/core`'s `DOC_KINDS` (`packages/core/src/domain/schema.ts`); kept in sync by hand since `packages/db` has no dependency on `@prdm/core`. */
export const documentKind = pgEnum('document_kind', ['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'WO', 'ART', 'FB']);

/** `collab`: authored in the editor; `generated`: written only by engine operations (WOs, MCP feedback/FR/ART); `import`: brought in from the pre-SaaS local flow. */
export const documentOrigin = pgEnum('document_origin', ['collab', 'generated', 'import']);

/** SDD-007 "Documentos y flujo": `draft -> in_review -> published -> archived`. */
export const documentWorkflowState = pgEnum('document_workflow_state', ['draft', 'in_review', 'published', 'archived']);

export const documentVersionReason = pgEnum('document_version_reason', ['manual', 'review_request', 'published', 'agent_accept', 'restore', 'engine_write', 'import']);

export const commitTrust = pgEnum('commit_trust', ['baseline', 'preview', 'import']);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    /** The stable `KIND-NNN` id (`docId` in `@prdm/core`), unique per project (`id_counters` assigns it). */
    docId: text('doc_id').notNull(),
    kind: documentKind('kind').notNull(),
    title: text('title').notNull(),
    /** Normalized to `<carpeta del kind>/<ID>*.md` (SDD-007). */
    sourcePath: text('source_path').notNull(),
    origin: documentOrigin('origin').notNull(),
    workflowState: documentWorkflowState('workflow_state').notNull().default('draft'),
    /** Yjs update/state vector snapshot of the live working copy; `null` for a document with no unpublished edits (e.g. right after publish, or a generated document, which has no working copy of its own). */
    workingState: bytea('working_state'),
    /** See the module doc comment: deliberately not a foreign key. */
    publishedVersionId: uuid('published_version_id'),
    /** The last published `## frontmatter + body` markdown, exactly as an MCP client (developer) sees it via `scan()`. */
    publishedRaw: text('published_raw'),
    publishedContentHash: text('published_content_hash'),
    /** Cached result of the last `validateDocument` run against this document, so the editor can show it without recomputing on every read. */
    lastValidation: jsonb('last_validation'),
    /**
     * WO-139 deliberate SDD-008 placeholder: a shallow field-merge patch an engine write (e.g.
     * `createFeatureRequest` appending to a Feedback's `informs`, or `closeFeature` closing a Feature)
     * queued for a `collab`-origin document instead of ever being applied via a direct `UPDATE
     * working_state`/`published_raw` — SDD-007's explicit invariant, since a change already broadcast
     * to a live `Y.Doc` can't be undone if the write's transaction later rolls back. `null` when there
     * is no pending patch. A future SDD-008 work order applies this as a real Yjs transaction (a
     * server-attributed commit, per SDD-007) once `packages/collab` exists, then clears it.
     */
    pendingEditablePatch: jsonb('pending_editable_patch'),
    /**
     * WO-145 (SDD-008 §"Servidor de tiempo real"): the `doc_updates.seq` this document's `workingState`
     * snapshot already reflects — `0` when there is no snapshot yet (matches the column's own default
     * and a never-collab-edited document). `onLoadDocument` decodes `workingState` and then replays
     * every `doc_updates` row with `seq > snapshotSeq`, so a debounced snapshot can never silently drop
     * updates written after it was taken but before the next debounce fires (or across a restart).
     * `onStoreDocument` sets this to the highest `seq` written for the document at the moment it stores.
     */
    snapshotSeq: integer('snapshot_seq').notNull().default(0),
    createdBy: text('created_by').references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('documents_project_id_doc_id_key').on(table.projectId, table.docId),
    // Target of document_versions' composite FK below.
    unique('documents_id_org_id_key').on(table.id, table.orgId),
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'documents_project_org_fk',
    }),
    index('documents_org_id_idx').on(table.orgId),
    index('documents_project_id_idx').on(table.projectId),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    versionNo: integer('version_no').notNull(),
    label: text('label'),
    reason: documentVersionReason('reason').notNull(),
    /** Yjs snapshot at the moment this version was captured; `null` for a version with no working-copy state (e.g. a bare `import`). */
    yjsState: bytea('yjs_state'),
    renderedMarkdown: text('rendered_markdown').notNull(),
    frontmatter: jsonb('frontmatter').notNull().default({}),
    contentHash: text('content_hash').notNull(),
    contributors: text('contributors').array().notNull().default(sql`'{}'::text[]`),
    /** `null` for a version an engine operation wrote on nobody's behalf (`reason = 'engine_write'`). */
    createdBy: text('created_by').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('document_versions_document_id_version_no_key').on(table.documentId, table.versionNo),
    foreignKey({
      columns: [table.documentId, table.orgId],
      foreignColumns: [documents.id, documents.orgId],
      name: 'document_versions_document_org_fk',
    }),
    index('document_versions_org_id_idx').on(table.orgId),
    index('document_versions_document_id_idx').on(table.documentId),
  ],
);

export const idCounters = pgTable(
  'id_counters',
  {
    projectId: uuid('project_id').notNull(),
    orgId: text('org_id').notNull(),
    kind: documentKind('kind').notNull(),
    lastSeq: integer('last_seq').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.kind], name: 'id_counters_pkey' }),
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'id_counters_project_org_fk',
    }),
    index('id_counters_org_id_idx').on(table.orgId),
  ],
);

export const projectBaselines = pgTable(
  'project_baselines',
  {
    projectId: uuid('project_id').primaryKey(),
    orgId: text('org_id').notNull(),
    baseline: jsonb('baseline').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'project_baselines_project_org_fk',
    }),
    index('project_baselines_org_id_idx').on(table.orgId),
  ],
);

export const commits = pgTable(
  'commits',
  {
    projectId: uuid('project_id').notNull(),
    sha: text('sha').notNull(),
    orgId: text('org_id').notNull(),
    trust: commitTrust('trust').notNull(),
    /** The CI token (SDD-010) that reported this commit; `null` for a commit imported/seeded outside a CI report. */
    reporterTokenId: uuid('reporter_token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    author: text('author').notNull(),
    date: timestamp('date', { withTimezone: true, mode: 'date' }).notNull(),
    subject: text('subject').notNull(),
    refs: text('refs').array().notNull().default(sql`'{}'::text[]`),
    files: text('files').array().notNull().default(sql`'{}'::text[]`),
    branches: text('branches').array().notNull().default(sql`'{}'::text[]`),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.sha], name: 'commits_pkey' }),
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'commits_project_org_fk',
    }),
    check('commits_sha_format', sql`${table.sha} ~ '^[0-9a-f]{7,40}$'`),
    index('commits_org_id_idx').on(table.orgId),
  ],
);

export const projectCodeState = pgTable(
  'project_code_state',
  {
    projectId: uuid('project_id').primaryKey(),
    orgId: text('org_id').notNull(),
    latestReportId: uuid('latest_report_id'),
    latestBaselineReportId: uuid('latest_baseline_report_id'),
    /** Hash of each blueprint's `impacts_paths` as of the last report that reconciled it (SDD-007: "guarda el hash de impacts_paths de cada blueprint usado en el reporte"). */
    impactsHashes: jsonb('impacts_hashes'),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.orgId],
      foreignColumns: [projects.id, projects.orgId],
      name: 'project_code_state_project_org_fk',
    }),
    index('project_code_state_org_id_idx').on(table.orgId),
  ],
);
