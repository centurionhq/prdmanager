/**
 * `documents`/`document_versions` repository (SDD-007 "Documentos y flujo", WO-136): the human-authored
 * document lifecycle `draft -> in_review -> published -> archived`, tenant-scoped the same way every
 * other repository in `repositories.ts` is (never a raw `org_id` in this module's public surface).
 *
 * Deliberately dependency-free of `@prdm/core` (SDD-006 §Arquitectura's one-way dependency graph: `db`
 * never depends on `core`), so `createDraft`'s templating (substituting the real id into
 * `templateFor(kind)`, slugifying the title into a `source_path`, hashing the content) is the caller's
 * (`packages/server`) job — `buildContent` is invoked here only once the new `doc_id` is actually known
 * (right after `nextDocId`), inside the same transaction, so the two can never be sequenced wrong.
 *
 * State-transition methods (`requestReview`/`archive`) are deliberately dumb guarded updates (`WHERE
 * workflow_state = <expected>`, returning `null` on no match): the business rule specific to archiving
 * (nothing published may still link to the document) belongs in the route layer, which has to run
 * `scanContents` over `listPublished()` first anyway — mixing that into this repository would make it
 * depend on `@prdm/core` too.
 */
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { nextDocId, type DocumentKind } from './id-counters.js';
import { documents, documentVersions } from './schema/documents.js';
import { withTenantTx } from './tenant.js';

export type DocumentRecord = typeof documents.$inferSelect;
export type DocumentVersionRecord = typeof documentVersions.$inferSelect;
export type DocumentWorkflowState = DocumentRecord['workflowState'];

export interface DocumentListFilter {
  kind?: DocumentKind;
  workflowState?: DocumentWorkflowState;
}

export interface CreateDraftDocumentInput {
  kind: DocumentKind;
  title: string;
  createdBy: string;
  /** Invoked with the freshly allocated `doc_id`, inside the same transaction that allocated it. */
  buildContent: (docId: string) => { sourcePath: string; renderedMarkdown: string; contentHash: string };
}

export interface DocumentWithLatestVersion {
  document: DocumentRecord;
  latestVersion: DocumentVersionRecord | null;
}

export interface PublishedDocumentRaw {
  docId: string;
  sourcePath: string;
  publishedRaw: string;
}

export interface DocumentsRepository {
  list(filter?: DocumentListFilter): Promise<DocumentRecord[]>;
  /** `null` for both "wrong org" and "doesn't exist" (SDD-006 §Arquitectura: both map to 404). */
  findByDocId(docId: string): Promise<DocumentWithLatestVersion | null>;
  createDraft(input: CreateDraftDocumentInput): Promise<DocumentWithLatestVersion>;
  /** Guarded `draft -> in_review`; `null` when the document wasn't `draft` (caller returns 409). */
  requestReview(docId: string): Promise<DocumentRecord | null>;
  /** Guarded `published -> archived`; `null` when the document wasn't `published` (caller returns
   * 409) — the "nothing links to it" rule is enforced by the caller before this is ever invoked. */
  archive(docId: string): Promise<DocumentRecord | null>;
  /** Every currently published document's raw content (excluding `excludeDocId`, if given) — for
   * `scanContents`-based link checks. */
  listPublished(excludeDocId?: string): Promise<PublishedDocumentRaw[]>;
}

function latestVersionOf(versions: DocumentVersionRecord[]): DocumentVersionRecord | null {
  return versions.reduce<DocumentVersionRecord | null>((latest, v) => (!latest || v.versionNo > latest.versionNo ? v : latest), null);
}

export function buildDocumentsRepository(pool: Pool, orgId: string, projectId: string): DocumentsRepository {
  return {
    list: (filter = {}) =>
      withTenantTx(pool, orgId, (tx) => {
        const conditions = [eq(documents.projectId, projectId)];
        if (filter.kind) conditions.push(eq(documents.kind, filter.kind));
        if (filter.workflowState) conditions.push(eq(documents.workflowState, filter.workflowState));
        return tx
          .select()
          .from(documents)
          .where(and(...conditions));
      }),

    findByDocId: (docId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [document] = await tx.select().from(documents).where(and(eq(documents.projectId, projectId), eq(documents.docId, docId)));
        if (!document) return null;
        const versions = await tx.select().from(documentVersions).where(eq(documentVersions.documentId, document.id));
        return { document, latestVersion: latestVersionOf(versions) };
      }),

    createDraft: (input) =>
      withTenantTx(pool, orgId, async (tx) => {
        const docId = await nextDocId(tx, projectId, input.kind);
        const { sourcePath, renderedMarkdown, contentHash } = input.buildContent(docId);

        const [document] = await tx
          .insert(documents)
          .values({ orgId, projectId, docId, kind: input.kind, title: input.title, sourcePath, origin: 'collab', workflowState: 'draft', createdBy: input.createdBy })
          .returning();
        if (!document) throw new Error(`failed to insert document row for ${docId}`);

        const [latestVersion] = await tx
          .insert(documentVersions)
          .values({ orgId, documentId: document.id, versionNo: 1, reason: 'manual', renderedMarkdown, frontmatter: {}, contentHash, contributors: [input.createdBy], createdBy: input.createdBy })
          .returning();
        if (!latestVersion) throw new Error(`failed to insert version row for ${docId}`);

        return { document, latestVersion };
      }),

    requestReview: (docId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [row] = await tx
          .update(documents)
          .set({ workflowState: 'in_review', updatedAt: new Date() })
          .where(and(eq(documents.projectId, projectId), eq(documents.docId, docId), eq(documents.workflowState, 'draft')))
          .returning();
        return row ?? null;
      }),

    archive: (docId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [row] = await tx
          .update(documents)
          .set({ workflowState: 'archived', updatedAt: new Date() })
          .where(and(eq(documents.projectId, projectId), eq(documents.docId, docId), eq(documents.workflowState, 'published')))
          .returning();
        return row ?? null;
      }),

    listPublished: (excludeDocId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const rows = await tx
          .select({ docId: documents.docId, sourcePath: documents.sourcePath, publishedRaw: documents.publishedRaw })
          .from(documents)
          .where(and(eq(documents.projectId, projectId), eq(documents.workflowState, 'published')));
        return rows
          .filter((r) => r.publishedRaw !== null && r.docId !== excludeDocId)
          .map((r) => ({ docId: r.docId, sourcePath: r.sourcePath, publishedRaw: r.publishedRaw as string }));
      }),
  };
}
