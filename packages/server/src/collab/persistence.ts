/**
 * Hocuspocus persistence (SDD-008 §"Servidor de tiempo real", WO-145): `onLoadDocument` hydrates a
 * document's `Y.Doc` from `documents.working_state`, replays any `doc_updates` row written after that
 * snapshot was taken, then applies WO-139's `pending_editable_patch` placeholder as a real,
 * server-attributed transaction and clears it — so an engine write queued before this package existed
 * finally reaches the live document exactly once. `onStoreDocument` (debounced by Hocuspocus itself,
 * `debounce`/`maxDebounce` in the `Hocuspocus` configuration — set to `0` in tests, never a real timer
 * this test suite has to wait out) persists the encoded state and records the `doc_updates.seq` it now
 * represents.
 *
 * Deliberately does not write to `doc_updates` itself (WO-149's `onChange` hook owns that) — this
 * extension only ever *reads* it, so `documents.snapshotSeq` staying `0` (no rows yet) is just the
 * "nothing to replay" case, exercised by every test until WO-149 lands.
 */
import { and, desc, eq, gt } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import { resolveDocumentById, schema, withTenantTx, type PgDatabase } from '@prdm/db';
import { assertValidRoot, FRONTMATTER_ROOT, InvalidDocumentRootError, type FrontmatterValue } from '@prdm/collab';
import { parseDocumentName } from './document-name.js';
import { createDocSizeTracker, type DocSizeTracker } from './doc-size-tracker.js';
import { defaultLiveYDocCache, type LiveYDocCache } from './reconstruct-ydoc.js';

/** Matches `@hocuspocus/server`'s own `Extension` interface structurally (never imported directly: this
 * module stays decoupled from the exact Hocuspocus version's exported type surface, same reasoning as
 * the learning test's own casts). */
export interface CollabPersistenceExtension {
  extensionName: string;
  onLoadDocument(data: { documentName: string; document: Y.Doc }): Promise<void>;
  onStoreDocument(data: { documentName: string; document: Y.Doc }): Promise<void>;
  afterUnloadDocument(data: { documentName: string }): Promise<void>;
}

export interface CollabPersistenceDeps {
  pool: Pool;
  /** WO-221: seeded once per document load from the actual encoded size (so a server restart never
   * silently resets a near-the-limit document's counter to zero), and evicted on `afterUnloadDocument`.
   * Defaults to a fresh, unshared tracker (harmless for callers — e.g. existing tests — that don't care
   * about size tracking); `register-collab-route.ts` passes the one shared instance every other extension
   * reads. */
  sizeTracker?: DocSizeTracker;
  /** WO-223: evicted on both load and unload — see `./reconstruct-ydoc.js`'s own doc comment for why a
   * *load* also has to invalidate it (content a live session applies outside the normal sync path, like
   * WO-139's `pending_editable_patch`, never becomes its own `doc_updates` row). Defaults to the one
   * shared {@link defaultLiveYDocCache} instance every blame/restore/versions/comments call site reads
   * through. */
  liveYDocCache?: LiveYDocCache;
}

/** `system:engine` per SDD-008 §"Autoría por línea no falsificable": a server-attributed transaction,
 * never a real connection's client id. */
export const PENDING_PATCH_ORIGIN = 'system:engine';
const REPLAY_ORIGIN = 'system:replay';
const SNAPSHOT_LOAD_ORIGIN = 'system:load';

/** Applies WO-139's shallow field-merge patch onto `fm`, skipping (never throwing on) any key whose
 * value isn't a valid frontmatter value — `pending_editable_patch` is `EngineOps.updateDocument`'s
 * generic `FieldValue` (which also allows `Record<string, string>`, never actually produced by any
 * collab-origin caller today; see `packages/core/src/parser/frontmatter-edit.ts`) rather than collab's
 * narrower `FrontmatterValue`. A malformed/future-incompatible key must never block the entire document
 * from loading. */
function applyPendingPatch(document: Y.Doc, patch: Record<string, unknown>): void {
  document.transact(() => {
    const fm = document.getMap<FrontmatterValue>(FRONTMATTER_ROOT);
    for (const [key, value] of Object.entries(patch)) {
      try {
        assertValidRoot(FRONTMATTER_ROOT, key, value);
      } catch (err) {
        if (err instanceof InvalidDocumentRootError) continue;
        throw err;
      }
      fm.set(key, value as FrontmatterValue);
    }
  }, PENDING_PATCH_ORIGIN);
}

async function replayTail(tx: PgDatabase, document: Y.Doc, documentId: string, snapshotSeq: number): Promise<void> {
  const rows = await tx
    .select({ update: schema.docUpdates.update })
    .from(schema.docUpdates)
    .where(and(eq(schema.docUpdates.documentId, documentId), gt(schema.docUpdates.seq, snapshotSeq)))
    .orderBy(schema.docUpdates.seq);
  for (const row of rows) {
    Y.applyUpdate(document, row.update, REPLAY_ORIGIN);
  }
}

export function createCollabPersistenceExtension(deps: CollabPersistenceDeps): CollabPersistenceExtension {
  const { pool, sizeTracker = createDocSizeTracker(), liveYDocCache = defaultLiveYDocCache } = deps;

  return {
    extensionName: 'prdm-collab-persistence',

    async onLoadDocument({ documentName, document }) {
      const parsed = parseDocumentName(documentName);
      if (!parsed) throw new Error(`invalid documentName "${documentName}"`);
      const resolved = await resolveDocumentById(pool, parsed.documentId);
      if (!resolved) throw new Error(`document ${parsed.documentId} does not exist`);

      await withTenantTx(pool, resolved.orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.documents)
          .where(and(eq(schema.documents.id, parsed.documentId), eq(schema.documents.projectId, parsed.projectId)));
        if (!row) throw new Error(`document ${parsed.documentId} not found in project ${parsed.projectId}`);

        if (row.workingState) {
          Y.applyUpdate(document, row.workingState, SNAPSHOT_LOAD_ORIGIN);
        }

        await replayTail(tx, document, row.id, row.snapshotSeq);

        if (row.pendingEditablePatch && typeof row.pendingEditablePatch === 'object' && !Array.isArray(row.pendingEditablePatch)) {
          applyPendingPatch(document, row.pendingEditablePatch as Record<string, unknown>);
          await tx.update(schema.documents).set({ pendingEditablePatch: null }).where(eq(schema.documents.id, row.id));
        }
      });

      // WO-221: seed the running byte counter from the document's real, fully-hydrated encoded size —
      // computed once here (a normal document load, never on the `beforeSync` hot path) so a server
      // restart never silently resets a near-the-limit document's counter back to zero.
      sizeTracker.seed(parsed.documentId, Y.encodeStateAsUpdate(document).byteLength);

      // WO-223: a live session may have just applied content (the pending-patch branch above) that never
      // becomes its own `doc_updates` row — any reconstruction cached for this document from before this
      // load must not keep being served as if it were still current.
      liveYDocCache.evict(parsed.documentId);
    },

    async afterUnloadDocument({ documentName }) {
      const parsed = parseDocumentName(documentName);
      if (!parsed) return;
      sizeTracker.delete(parsed.documentId);
      liveYDocCache.evict(parsed.documentId);
    },

    async onStoreDocument({ documentName, document }) {
      const parsed = parseDocumentName(documentName);
      if (!parsed) return;
      const resolved = await resolveDocumentById(pool, parsed.documentId);
      if (!resolved) return;

      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      await withTenantTx(pool, resolved.orgId, async (tx) => {
        // Highest `seq` written for this document so far: `working_state` (about to be overwritten
        // below) already reflects every `doc_updates` row up to and including it, so it becomes the
        // new `snapshotSeq` this document's next `onLoadDocument` replay starts strictly after.
        const [latest] = await tx
          .select({ seq: schema.docUpdates.seq })
          .from(schema.docUpdates)
          .where(eq(schema.docUpdates.documentId, parsed.documentId))
          .orderBy(desc(schema.docUpdates.seq))
          .limit(1);
        const snapshotSeq = latest?.seq ?? 0;
        await tx
          .update(schema.documents)
          .set({ workingState: state, snapshotSeq, updatedAt: new Date() })
          .where(eq(schema.documents.id, parsed.documentId));
      });
    },
  };
}
