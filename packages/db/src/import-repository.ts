/**
 * `POST .../import`'s document-creation transaction (SDD-007 "Documentos y flujo"/SDD-010 "Importador",
 * WO-192): every imported document is created `published`, `origin: 'import'`, with a single `version 1`
 * `document_versions` row (`reason: 'import'`) — mirroring exactly the shape `PgProjectEngine.publishDocument`
 * already leaves a normally-published document in (no `working_state`/live `Y.Doc` build at creation time;
 * the collaborative document materializes lazily on first open, same as every other document). Attributed
 * to nobody in particular (`IMPORT_ACTOR_ID`), the same "system actor, not a real user" convention
 * `packages/server`'s `acceptAgentProposal` already uses for `AGENT_ACTOR_ID`.
 *
 * Requires the target project to have zero documents (SDD-010: "exige que el proyecto esté vacío"): a
 * one-time bootstrap operation, never a merge into an existing project's content.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { DocumentKind } from './id-counters.js';
import { documents, documentVersions } from './schema/documents.js';
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

export interface ImportDocumentsInput {
  orgId: string;
  projectId: string;
  documents: readonly ImportDocumentInput[];
}

/** Inserts every document, atomically, after re-checking the project is still empty inside the same
 * transaction (never a separate check-then-insert with a race window). */
export async function importDocuments(pool: Pool, input: ImportDocumentsInput): Promise<ImportedDocumentRecord[]> {
  return withTenantTx(pool, input.orgId, async (tx) => {
    const existing = await tx.select({ id: documents.id }).from(documents).where(eq(documents.projectId, input.projectId)).limit(1);
    if (existing.length > 0) throw new ProjectNotEmptyError();

    const created: ImportedDocumentRecord[] = [];
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
    }
    return created;
  });
}
