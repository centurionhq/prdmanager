/**
 * Reconstructs a document's current `Y.Doc` from `documents.working_state` plus the `doc_updates` tail
 * past `documents.snapshot_seq` — exactly what `./persistence.js`'s `onLoadDocument` does for a live
 * Hocuspocus connection, factored out so anything that needs a read-only snapshot of "the document as it
 * is right now" without actually opening a collab connection (blame, `WO-154`; version capture, `WO-156`)
 * shares one implementation rather than three slightly different re-derivations of the same replay logic.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import { createTenantDb, schema, withTenantTx, type DocUpdateRow } from '@prdm/db';
import { createDocumentYDoc } from '@prdm/collab';

export interface ReconstructedDocument {
  ydoc: Y.Doc;
  /** Every `doc_updates` row ever recorded for this document, oldest first — the full attribution
   * history, needed by blame's `RangeIndex` and by version capture's contributor computation alike. */
  updates: DocUpdateRow[];
  /** `false` when neither `working_state` nor any `doc_updates` row exists for this document — i.e. the
   * live collab document has never actually been opened/edited, so `ydoc` is still the pristine empty
   * document `createDocumentYDoc()` produces, not a meaningful "current state". A fresh draft's real
   * initial content lives only in `document_versions`' version 1 (`documents-repository.ts`'s
   * `createDraft`) until a client's first collab connection seeds the working copy — callers that would
   * otherwise silently capture/publish an empty body over real content (WO-156's automatic version
   * capture) must check this before treating `ydoc` as authoritative. */
  hasLiveHistory: boolean;
}

export async function reconstructLiveYDoc(pool: Pool, orgId: string, documentId: string): Promise<ReconstructedDocument> {
  const documentRow = await withTenantTx(pool, orgId, async (tx) => {
    const [row] = await tx.select({ workingState: schema.documents.workingState, snapshotSeq: schema.documents.snapshotSeq }).from(schema.documents).where(eq(schema.documents.id, documentId));
    return row ?? null;
  });

  const ydoc = createDocumentYDoc();
  if (documentRow?.workingState) Y.applyUpdate(ydoc, documentRow.workingState);

  const updates = await createTenantDb(pool).forOrg(orgId).docUpdates.listForDocument(documentId);
  const snapshotSeq = documentRow?.snapshotSeq ?? 0;
  for (const row of updates) {
    if (row.seq > snapshotSeq) Y.applyUpdate(ydoc, row.update);
  }

  const hasLiveHistory = documentRow?.workingState != null || updates.length > 0;
  return { ydoc, updates, hasLiveHistory };
}
