/**
 * Version restore as a server-attributed transaction (SDD-008 §"Versiones": "Restaurar reconstruye con
 * Y.createDocFromSnapshot y aplica la diferencia como transacción de servidor atribuida al usuario que
 * restaura (no se reescribe la historia)").
 *
 * `Hocuspocus.openDirectConnection`'s `DirectConnection.transact` mutates the *live* `Document` directly
 * (`document.transact(fn, {source: 'local', ...})`, confirmed by reading the installed 4.7.0 source) —
 * it never goes through `readSyncMessage`, so `beforeSync` (this batch's `./attribution.js`/
 * `./anti-spoofing.js`, WO-149/150) never runs for it. A direct connection is therefore the one case in
 * this codebase that must durably write its own `doc_updates`/`doc_client_bindings` row itself, right
 * after applying, rather than relying on the live-connection hook pipeline — there is no incoming wire
 * message here for that pipeline to have intercepted in the first place.
 *
 * Per SDD-008's "cada transacción de servidor usa un client id nuevo": the live `Document`'s own
 * `clientID` (assigned once, whenever it was first loaded into memory, and otherwise stable for as long
 * as it stays loaded) is deliberately overwritten with a fresh random one immediately before the
 * transaction, so this restore's inserted structs get their own identity distinct from anything else
 * ever written under that in-memory `Document` object — exactly what {@link computeBlame} needs to
 * attribute only the lines this restore actually touched to the restoring user.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import type { Pool } from 'pg';
import { applyProjection, decodeUpdateRanges, projectDoc } from '@prdm/collab';
import { schema, withTenantTx, type DocumentVersionRecord } from '@prdm/db';
import { formatDocumentName } from './document-name.js';
import { captureDocumentVersion } from './versions.js';
import { reconstructLiveYDoc } from './reconstruct-ydoc.js';

const DOC_UPDATES_LOCK_SALT = 0x5044_5530; // 'PDU0' — same salt as ./doc-update-writer.ts (same keyspace).

/** A fresh, unregistered 32-bit Yjs client id — same generation shape `yjs` itself uses internally
 * (`Math.floor(Math.random() * 2**32)`; `generateNewClientId` isn't part of `yjs`'s public API surface). */
function freshClientId(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export interface RestoreDocumentVersionInput {
  orgId: string;
  projectId: string;
  documentId: string;
  versionNo: number;
  restoringUserId: string;
}

export class VersionNotFoundError extends Error {}
export class VersionHasNoSnapshotError extends Error {}

export async function restoreDocumentVersion(pool: Pool, hocuspocus: Hocuspocus, input: RestoreDocumentVersionInput): Promise<DocumentVersionRecord> {
  const { orgId, projectId, documentId, versionNo, restoringUserId } = input;

  const targetVersion = await withTenantTx(pool, orgId, async (tx) => {
    const [row] = await tx.select().from(schema.documentVersions).where(and(eq(schema.documentVersions.documentId, documentId), eq(schema.documentVersions.versionNo, versionNo)));
    return row ?? null;
  });
  if (!targetVersion) throw new VersionNotFoundError(`version ${versionNo} not found for document ${documentId}`);
  if (!targetVersion.yjsState) throw new VersionHasNoSnapshotError(`version ${versionNo} has no captured Y.Doc snapshot to restore from`);

  // The full history (every struct/delete this document has ever recorded, tombstones included thanks to
  // `gc: false` everywhere) is what `Y.createDocFromSnapshot` needs to reconstruct the target version's
  // exact content — never the target version's own `renderedMarkdown` (that would be a wholesale
  // re-parse, losing per-field precision `projectDoc` already gives for free).
  const { ydoc: historicalDoc } = await reconstructLiveYDoc(pool, orgId, documentId);
  const snapshot = Y.decodeSnapshot(targetVersion.yjsState);
  const restoredDoc = Y.createDocFromSnapshot(historicalDoc, snapshot);
  const restoredProjection = projectDoc(restoredDoc);

  const documentName = formatDocumentName(projectId, documentId);
  const direct = await hocuspocus.openDirectConnection(documentName, {});
  try {
    const liveDocument = direct.document;
    if (!liveDocument) throw new Error(`direct connection to ${documentName} has no document`);

    liveDocument.clientID = freshClientId();
    const before = Y.encodeStateVector(liveDocument);
    await direct.transact((doc) => applyProjection(doc, restoredProjection, 'system:restore'));
    const update = Y.encodeStateAsUpdate(liveDocument, before);

    if (update.length > 0) {
      const { structRanges, deleteRanges } = decodeUpdateRanges(update);
      await withTenantTx(pool, orgId, async (tx) => {
        await tx.execute(withAdvisoryLockSql(documentId));
        const [latest] = await tx.select({ seq: schema.docUpdates.seq }).from(schema.docUpdates).where(eq(schema.docUpdates.documentId, documentId)).orderBy(desc(schema.docUpdates.seq)).limit(1);
        const seq = (latest?.seq ?? 0) + 1;

        await tx.insert(schema.docUpdates).values({
          orgId,
          documentId,
          seq,
          actorKind: 'user',
          userId: restoringUserId,
          onBehalfOf: null,
          agentId: null,
          connectionId: null,
          update: Buffer.from(update),
          structRanges,
          deleteRanges,
        });
        await tx
          .insert(schema.docClientBindings)
          .values({ documentId, orgId, clientId: String(liveDocument.clientID), userId: restoringUserId, actorKind: 'user' })
          .onConflictDoNothing({ target: [schema.docClientBindings.documentId, schema.docClientBindings.clientId] });
      });
    }
  } finally {
    await direct.disconnect();
  }

  const version = await captureDocumentVersion(pool, orgId, { documentId, reason: 'restore', createdBy: restoringUserId });
  if (!version) throw new Error(`restore of document ${documentId} unexpectedly produced no live collab history to capture`);
  return version;
}

// Kept as a tiny helper (rather than inlined `sql` template) only so the lock's own reasoning — matching
// `./doc-update-writer.js`'s exact salt/keyspace — reads as one sentence at the call site above.
function withAdvisoryLockSql(documentId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${documentId}::text, ${DOC_UPDATES_LOCK_SALT}))`;
}
