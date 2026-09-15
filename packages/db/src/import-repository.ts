/**
 * `POST .../import`'s document-creation transaction (SDD-007 "Documentos y flujo"/SDD-010 "Importador",
 * WO-192/WO-193): every imported document is created `published`, `origin: 'import'`, with a single
 * `version 1` `document_versions` row (`reason: 'import'`) — mirroring exactly the shape
 * `PgProjectEngine.publishDocument` already leaves a normally-published document in (no `working_state`/
 * live `Y.Doc` build at creation time; the collaborative document materializes lazily on first open, same
 * as every other document). Attributed to nobody in particular (`IMPORT_ACTOR_ID`), the same "system
 * actor, not a real user" convention `packages/server`'s `acceptAgentProposal` already uses for
 * `AGENT_ACTOR_ID`.
 *
 * Requires the target project to have zero documents (SDD-010: "exige que el proyecto esté vacío"): a
 * one-time bootstrap operation, never a merge into an existing project's content.
 *
 * WO-193 side effects, all inside the same transaction as the document inserts:
 *  - `id_counters` seeded to at least each kind's highest imported sequence number, so the next
 *    locally-created document never collides with an imported id.
 *  - `lifecycle.grandfathered` merged into `projects.settings` (the same jsonb `governance` reads from).
 *  - `.prdm/baseline.json`'s content, when given, imported verbatim into `project_baselines`.
 *  - Every sha named in an imported work order's `resolved_by` gets a `commits` row with
 *    `trust: 'import'` — "carrying over pre-existing state, not yet CI-verified": deliberately NOT
 *    `'baseline'`, and `project_code_state.latestBaselineHeadSha` is never touched here either, so the
 *    *first* real CI-verified report is still treated as this project's very first baseline (no
 *    force-push override needed) rather than retroactively legitimizing whatever the import claimed.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { seedIdCounterAtLeast, type DocumentKind } from './id-counters.js';
import { commits, documents, documentVersions, projectBaselines } from './schema/documents.js';
import { projects } from './schema/projects.js';
import { withTenantTx } from './tenant.js';

export const IMPORT_ACTOR_ID = 'system:import';

export class ProjectNotEmptyError extends Error {
  constructor() {
    super('the target project already has documents; import requires an empty project');
    this.name = 'ProjectNotEmptyError';
  }
}

export interface ImportDocumentInput {
  kind: DocumentKind;
  docId: string;
  title: string;
  sourcePath: string;
  /** The raw markdown exactly as it existed locally — never re-serialized (so a document's content hash
   * never changes across import, the round-trip property SDD-010 requires). */
  renderedMarkdown: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
}

export type ImportedDocumentRecord = typeof documents.$inferSelect;

export interface ImportGrandfatheredEntry {
  id: string;
  hash: string;
}

export interface ImportDocumentsInput {
  orgId: string;
  projectId: string;
  documents: readonly ImportDocumentInput[];
  /** `.prdm.yaml`'s `lifecycle.grandfathered`, merged into `projects.settings.lifecycle.grandfathered`. */
  grandfathered?: readonly ImportGrandfatheredEntry[];
  /** `.prdm/baseline.json`'s already-parsed content, stored verbatim into `project_baselines.baseline`. */
  baseline?: Record<string, unknown>;
}

export interface ImportResult {
  documents: ImportedDocumentRecord[];
  /** Every distinct sha recorded into `commits` with `trust: 'import'` (from imported work orders'
   * `resolved_by`) — surfaced so the route can audit it as a privileged change. */
  importedCommitShas: string[];
  grandfatheredImported: boolean;
  baselineImported: boolean;
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/** The highest sequence number among `docId`s of a given kind (SDD-007's `KIND-NNN` format) — `0` when
 * none. Never trusts a non-matching id (defense in depth; every id here already passed core's schema). */
function maxSeqByKind(docIds: readonly { kind: DocumentKind; docId: string }[]): Map<DocumentKind, number> {
  const byKind = new Map<DocumentKind, number>();
  for (const { kind, docId } of docIds) {
    const match = /-(\d+)$/.exec(docId);
    if (!match) continue;
    const seq = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(seq)) continue;
    byKind.set(kind, Math.max(byKind.get(kind) ?? 0, seq));
  }
  return byKind;
}

/** Every distinct, well-formed sha named in a `WO` document's `resolved_by` array. */
function resolvedByShas(doc: ImportDocumentInput): string[] {
  if (doc.kind !== 'WO') return [];
  const raw = doc.frontmatter.resolved_by;
  if (!Array.isArray(raw)) return [];
  return raw.filter((sha): sha is string => typeof sha === 'string' && SHA_PATTERN.test(sha));
}

/** Inserts every document, atomically, after re-checking the project is still empty inside the same
 * transaction (never a separate check-then-insert with a race window), then applies every WO-193 side
 * effect in the same transaction. */
export async function importDocuments(pool: Pool, input: ImportDocumentsInput): Promise<ImportResult> {
  return withTenantTx(pool, input.orgId, async (tx) => {
    const existing = await tx.select({ id: documents.id }).from(documents).where(eq(documents.projectId, input.projectId)).limit(1);
    if (existing.length > 0) throw new ProjectNotEmptyError();

    const created: ImportedDocumentRecord[] = [];
    const shaSet = new Set<string>();
    for (const doc of input.documents) {
      const [row] = await tx
        .insert(documents)
        .values({
          orgId: input.orgId,
          projectId: input.projectId,
          docId: doc.docId,
          kind: doc.kind,
          title: doc.title,
          sourcePath: doc.sourcePath,
          origin: 'import',
          workflowState: 'published',
          publishedRaw: doc.renderedMarkdown,
          publishedContentHash: doc.contentHash,
          createdBy: null,
        })
        .returning();
      if (!row) throw new Error(`failed to insert document row for ${doc.docId}`);

      const [version] = await tx
        .insert(documentVersions)
        .values({
          orgId: input.orgId,
          documentId: row.id,
          versionNo: 1,
          reason: 'import',
          renderedMarkdown: doc.renderedMarkdown,
          frontmatter: doc.frontmatter,
          contentHash: doc.contentHash,
          contributors: [IMPORT_ACTOR_ID],
          createdBy: null,
        })
        .returning();
      if (!version) throw new Error(`failed to insert version row for ${doc.docId}`);

      const [updated] = await tx.update(documents).set({ publishedVersionId: version.id }).where(eq(documents.id, row.id)).returning();
      created.push(updated ?? row);
      for (const sha of resolvedByShas(doc)) shaSet.add(sha);
    }

    for (const [kind, seq] of maxSeqByKind(input.documents)) {
      await seedIdCounterAtLeast(tx, input.projectId, kind, seq);
    }

    const importedCommitShas = [...shaSet].sort();
    if (importedCommitShas.length > 0) {
      for (const sha of importedCommitShas) {
        await tx
          .insert(commits)
          .values({
            projectId: input.projectId,
            orgId: input.orgId,
            sha,
            trust: 'import',
            reporterTokenId: null,
            author: IMPORT_ACTOR_ID,
            date: new Date(),
            subject: '(imported)',
            refs: [],
            files: [],
            branches: [],
          })
          .onConflictDoNothing({ target: [commits.projectId, commits.sha] });
      }
    }

    let grandfatheredImported = false;
    if (input.grandfathered && input.grandfathered.length > 0) {
      const [project] = await tx.select({ settings: projects.settings }).from(projects).where(eq(projects.id, input.projectId));
      const currentSettings = (project?.settings as Record<string, unknown> | undefined) ?? {};
      const nextSettings = { ...currentSettings, lifecycle: { ...(currentSettings.lifecycle as Record<string, unknown> | undefined), grandfathered: input.grandfathered } };
      await tx.update(projects).set({ settings: nextSettings }).where(eq(projects.id, input.projectId));
      grandfatheredImported = true;
    }

    let baselineImported = false;
    if (input.baseline) {
      await tx
        .insert(projectBaselines)
        .values({ projectId: input.projectId, orgId: input.orgId, baseline: input.baseline })
        .onConflictDoUpdate({ target: projectBaselines.projectId, set: { baseline: input.baseline, updatedAt: new Date() } });
      baselineImported = true;
    }

    return { documents: created, importedCommitShas, grandfatheredImported, baselineImported };
  });
}
