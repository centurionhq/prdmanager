/**
 * `document_versions` capture (SDD-008 §"Versiones"): a point-in-time snapshot of a collaborative
 * document's live `Y.Doc`, taken either on demand (a manual save-with-label) or automatically at a
 * workflow transition (`request_review`; `publish` already creates its own version row via
 * `PgProjectEngine.publishDocument`, WO-137 — this module is never called for that reason, see the
 * module-level note in `../api/documents.ts`'s request-review route for why the two aren't unified).
 *
 * `yjs_state` stores `Y.encodeSnapshot(Y.snapshot(ydoc))` — a `Y.Snapshot` (state vector + delete set),
 * not a full state update — per SDD-008: "guarda ... Y.encodeSnapshot" for compact storage that still
 * lets a future restore (WO-157) reconstruct the exact tombstone-preserving state via
 * `Y.createDocFromSnapshot`. `renderedMarkdown`/`frontmatter` are the same shape `PgProjectEngine.
 * publishDocument` already stores (the full parsed frontmatter block, including `id`/`type`/`title`), so
 * a diff between an automatic-publish version and a collab-captured one compares like with like.
 *
 * `contributors`: `document_versions` has no "up to which doc_updates.seq" marker of its own, so
 * "distinct actors since the previous version" is approximated by `doc_updates.received_at` versus the
 * previous version's `created_at` — precise enough at this table's real write cadence (one version per
 * save-with-label or workflow transition, never per keystroke).
 */
import { desc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import { renderDocument, sha256, type FieldValue } from '@prdm/core';
import { projectDoc } from '@prdm/collab';
import { schema, withTenantTx, type DocumentVersionRecord } from '@prdm/db';
import { reconstructLiveYDoc } from './reconstruct-ydoc.js';

export type DocumentVersionReason = (typeof schema.documentVersionReason.enumValues)[number];

export interface CaptureDocumentVersionInput {
  documentId: string;
  reason: DocumentVersionReason;
  label?: string | null;
  /** `null` for a reason with no human behind it (mirrors `document_versions.created_by`'s own
   * nullability, e.g. a future `engine_write` capture). */
  createdBy: string | null;
}

function distinctContributors(updates: readonly { userId: string | null; onBehalfOf: string | null; receivedAt: Date }[], since: Date): string[] {
  const ids = updates.filter((u) => u.receivedAt > since).map((u) => u.userId ?? u.onBehalfOf).filter((id): id is string => id !== null);
  return Array.from(new Set(ids));
}

/**
 * `null` when the document's live collab document has never actually been opened/edited yet (see
 * `reconstructLiveYDoc`'s `hasLiveHistory` doc comment) — capturing it would silently overwrite the
 * document's real initial content (its `document_versions` version 1) with an empty body. Manual
 * save-with-label never hits this (the route only accepts it from an already-open editor), but an
 * automatic capture at a workflow transition (`request_review`) must check for `null` and simply skip.
 */
export async function captureDocumentVersion(pool: Pool, orgId: string, input: CaptureDocumentVersionInput): Promise<DocumentVersionRecord | null> {
  const { documentId, reason, label = null, createdBy } = input;

  const documentRow = await withTenantTx(pool, orgId, async (tx) => {
    const [row] = await tx.select({ docId: schema.documents.docId, kind: schema.documents.kind, title: schema.documents.title }).from(schema.documents).where(eq(schema.documents.id, documentId));
    return row ?? null;
  });
  if (!documentRow) throw new Error(`document ${documentId} not found`);

  const { ydoc, updates, hasLiveHistory } = await reconstructLiveYDoc(pool, orgId, documentId);
  if (!hasLiveHistory) return null;
  const projection = projectDoc(ydoc);
  const { id: _id, type: _type, title: _title, ...restFields } = projection.fields;
  const cleanFields: Record<string, FieldValue> = { ...restFields, id: documentRow.docId, type: documentRow.kind, title: projection.title || documentRow.title };
  const renderedMarkdown = renderDocument(cleanFields, projection.body);
  const contentHash = sha256(renderedMarkdown);
  const yjsState = Buffer.from(Y.encodeSnapshot(Y.snapshot(ydoc)));

  return withTenantTx(pool, orgId, async (tx) => {
    const [previous] = await tx
      .select({ versionNo: schema.documentVersions.versionNo, createdAt: schema.documentVersions.createdAt })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(desc(schema.documentVersions.versionNo))
      .limit(1);
    const versionNo = (previous?.versionNo ?? 0) + 1;
    const since = previous?.createdAt ?? new Date(0);

    const contributors = distinctContributors(updates, since);
    if (contributors.length === 0 && createdBy) contributors.push(createdBy);

    const [version] = await tx
      .insert(schema.documentVersions)
      .values({ orgId, documentId, versionNo, label, reason, yjsState, renderedMarkdown, frontmatter: cleanFields, contentHash, contributors, createdBy })
      .returning();
    if (!version) throw new Error(`failed to insert version ${versionNo} for document ${documentId}`);
    return version;
  });
}
