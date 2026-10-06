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
 * WO-447 (SDD-008 bug fix): `working_state` is null for every document up to its very first live collab
 * session — `createDraft` (`documents-repository.ts`) only ever writes `document_versions` version 1,
 * never touches Yjs state at all (see `reconstruct-ydoc.ts`'s own `hasLiveHistory` doc comment, which
 * already documented this gap as "until a client's first collab connection seeds the working copy"
 * without that seeding ever having been implemented anywhere). Without it, a freshly created document's
 * first editor session opened onto a genuinely empty `Y.Doc`, so Vista previa/Markdown showed nothing
 * despite the template body being fully present server-side. `seedFromMarkdown` now fills that gap:
 * when `working_state` is still null AND no `doc_updates` row exists either (a truly untouched draft,
 * never any real collab/agent write queued for it), it parses the document's latest `document_versions`
 * row (whatever `createDraft`/`saveVersion` most recently wrote) and applies it as the Y.Doc's initial
 * content — the very next `onStoreDocument` debounce then persists it to `working_state` for good, so
 * this only ever runs once per document.
 *
 * WO-596 (SDD-008 bug fix): the WO-447 seed above used to live only in the live in-memory `Y.Doc`,
 * never written to `doc_updates` (WO-149's `onChange`/`beforeSync` hook only ever logs real incoming
 * client sync messages) until the next debounced `onStoreDocument` flush. Any reconstruction of "the
 * document as it is right now" from durable storage alone (`reconstruct-ydoc.ts`'s `reconstructFromScratch`
 * — used by version capture on publish, comment-anchor resolution, blame, and restore) done in that
 * window replayed real client edits, whose Yjs structs reference the seed's structs by `left`/predecessor,
 * onto a `Y.Doc` that never received the seed at all: those structs' dependencies could never resolve, so
 * the reconstruction silently came out empty/incomplete (confirmed to reproduce deterministically, not as
 * flakiness). The seed transaction below is now durably journaled the same way `restore.ts` journals its
 * own server-authored Y.Doc mutations that aren't a client sync message — a real `doc_updates` row,
 * `actorKind: 'system'`, written via `writeDocUpdateBatch` after (necessarily — that writer opens its own
 * transaction/advisory lock) the read transaction below commits — so every reader of `doc_updates` sees
 * the same complete document a live session already does.
 *
 * That journal write can fail (a transient DB error) in a way nothing in this hook could before WO-596 —
 * unlike `onStoreDocument`'s own failures, Hocuspocus does not swallow a thrown `onLoadDocument`: it closes
 * the connection and rethrows, so the client's load genuinely fails. This is self-healing, not silent data
 * loss: nothing was journaled, so `documents` is exactly as if this load never ran, and the next connection
 * attempt retries the same seed-if-untouched branch cleanly. `pending_editable_patch` (WO-139, applied to
 * the in-memory `Y.Doc` inside the same read transaction) is deliberately *not* cleared until after the
 * seed diff above is durably journaled, for the same reason: clearing it any earlier and then having the
 * journal write fail would strand the patch (already committed as cleared, but its fields never reached any
 * client). Safe to retry regardless of exactly where a failure lands — `applyPendingPatch` only ever calls
 * `fm.set(key, value)`, idempotent on a `Y.Map` no matter how many times a reconnect reapplies it.
 */
import { and, desc, eq, gt } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import { parseDocument } from '@prdm/core';
import { resolveDocumentById, schema, withTenantTx, type PgDatabase } from '@prdm/db';
import { assertValidRoot, BODY_ROOT, decodeUpdateRanges, FRONTMATTER_ROOT, InvalidDocumentRootError, type FrontmatterValue } from '@prdm/collab';
import { parseDocumentName } from './document-name.js';
import { writeDocUpdateBatch } from './doc-update-writer.js';
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
const SEED_ORIGIN = 'system:seed';

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

/**
 * WO-447: fills the two Y.Doc roots (`@prdm/collab`'s `fm`/`body`, SDD-008 §"Representación del
 * documento") from `document_versions`' latest `renderedMarkdown` — mirrors `applyPendingPatch`'s
 * skip-invalid-field behavior (a value `assertValidRoot` rejects, e.g. `blueprint_hashes`'s object shape,
 * is silently dropped rather than blocking the whole load) since a template/generated document's
 * frontmatter can include fields the collab schema's `fm` root never accepts. A `renderedMarkdown` that
 * fails to parse (never expected for `createDraft`/`saveVersion`-produced content, but the Y.Doc must
 * never fail to load over it) leaves the document empty exactly as before this fix, rather than throwing.
 */
function seedFromMarkdown(document: Y.Doc, renderedMarkdown: string, sourcePath: string): void {
  const parsed = parseDocument(renderedMarkdown, sourcePath);
  if (!parsed?.ok) return;

  document.transact(() => {
    const fm = document.getMap<FrontmatterValue>(FRONTMATTER_ROOT);
    for (const [key, value] of Object.entries(parsed.doc.frontmatter)) {
      try {
        assertValidRoot(FRONTMATTER_ROOT, key, value);
      } catch (err) {
        if (err instanceof InvalidDocumentRootError) continue;
        throw err;
      }
      fm.set(key, value as FrontmatterValue);
    }
    document.getText(BODY_ROOT).insert(0, parsed.doc.node.body);
  }, SEED_ORIGIN);
}

/** Returns whether any row was actually replayed — WO-447's seed step must never run once real
 * `doc_updates` content exists for a document, even while `working_state` is still null (e.g. a row
 * written directly by an agent-proposal/restore flow that never went through a live Hocuspocus session's
 * own debounced `onStoreDocument`, exactly `documents-agent-proposals.test.ts`'s `seedLiveBody`). */
async function replayTail(tx: PgDatabase, document: Y.Doc, documentId: string, snapshotSeq: number): Promise<boolean> {
  const rows = await tx
    .select({ update: schema.docUpdates.update })
    .from(schema.docUpdates)
    .where(and(eq(schema.docUpdates.documentId, documentId), gt(schema.docUpdates.seq, snapshotSeq)))
    .orderBy(schema.docUpdates.seq);
  for (const row of rows) {
    Y.applyUpdate(document, row.update, REPLAY_ORIGIN);
  }
  return rows.length > 0;
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

      // WO-596: the transaction below returns the seed's own diff (if the seed step actually ran) and
      // whether a pending patch needs clearing, but does NOT clear it itself -- that has to wait until
      // *after* the seed diff is durably journaled (below). Clearing it here, in the same transaction that
      // reads it, would let a subsequent `writeDocUpdateBatch` failure strand the patch: already committed
      // as cleared in `documents`, but its fields only ever reached this one in-memory `Y.Doc`, which a
      // failed load never hands to any client. Deferring the clear until after the journal write means a
      // failure there instead leaves `pending_editable_patch` set for the next connection attempt to retry
      // -- safe to retry either way, since `applyPendingPatch` only ever calls `fm.set(key, value)`, and a
      // `Y.Map` set is idempotent regardless of how many times the same value lands.
      const { seedUpdate, pendingPatch } = await withTenantTx(pool, resolved.orgId, async (tx): Promise<{ seedUpdate: Uint8Array | null; pendingPatch: Record<string, unknown> | null }> => {
        const [row] = await tx
          .select()
          .from(schema.documents)
          .where(and(eq(schema.documents.id, parsed.documentId), eq(schema.documents.projectId, parsed.projectId)));
        if (!row) throw new Error(`document ${parsed.documentId} not found in project ${parsed.projectId}`);

        if (row.workingState) {
          Y.applyUpdate(document, row.workingState, SNAPSHOT_LOAD_ORIGIN);
        }

        const replayed = await replayTail(tx, document, row.id, row.snapshotSeq);

        let seedUpdate: Uint8Array | null = null;
        if (!row.workingState && !replayed) {
          const [latestVersion] = await tx
            .select({ renderedMarkdown: schema.documentVersions.renderedMarkdown })
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.documentId, row.id))
            .orderBy(desc(schema.documentVersions.versionNo))
            .limit(1);
          if (latestVersion) {
            const before = Y.encodeStateVector(document);
            seedFromMarkdown(document, latestVersion.renderedMarkdown, row.sourcePath);
            seedUpdate = Y.encodeStateAsUpdate(document, before);
          }
        }

        let pendingPatch: Record<string, unknown> | null = null;
        if (row.pendingEditablePatch && typeof row.pendingEditablePatch === 'object' && !Array.isArray(row.pendingEditablePatch)) {
          pendingPatch = row.pendingEditablePatch as Record<string, unknown>;
          applyPendingPatch(document, pendingPatch);
        }

        return { seedUpdate, pendingPatch };
      });

      if (seedUpdate && seedUpdate.length > 0) {
        const update = Buffer.from(seedUpdate);
        const { structRanges, deleteRanges } = decodeUpdateRanges(update);
        await writeDocUpdateBatch(pool, resolved.orgId, parsed.documentId, [
          { update, structRanges, deleteRanges, actorKind: 'system', userId: null, onBehalfOf: null, agentId: null, connectionId: null },
        ]);
      }

      if (pendingPatch) {
        await withTenantTx(pool, resolved.orgId, async (tx) => {
          await tx.update(schema.documents).set({ pendingEditablePatch: null }).where(eq(schema.documents.id, parsed.documentId));
        });
      }

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
        // Touch `documents` before `doc_updates` (see WO-244): `truncateAll` (`packages/testkit/src/
        // pg.ts`) truncates every `public` table in one statement, listed in ascending `pg_class.oid`
        // (creation order), and `documents` (oid 16935 in this schema) was created strictly before
        // `doc_updates` (oid 17071) — so `truncateAll` always takes `documents`'s `AccessExclusiveLock`
        // before `doc_updates`'s. This transaction used to do the exact opposite (SELECT `doc_updates`
        // first, then UPDATE `documents`), a fixed AB-BA lock order that deadlocked against a concurrent
        // `truncateAll` under CI's tighter timing — reproduced locally (see `packages/db/tests/
        // integration/documents-doc-updates-lock-order.test.ts`) by racing this exact statement order
        // against a real `truncateAll`. This throwaway `SELECT` exists purely to acquire `documents`'s
        // table-level lock first, establishing the same order every other multi-table writer in this
        // codebase must also follow.
        await tx.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.id, parsed.documentId)).limit(1);

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
