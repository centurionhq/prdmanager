/**
 * Reconstructs a document's current `Y.Doc` from `documents.working_state` plus the `doc_updates` tail
 * past `documents.snapshot_seq` — exactly what `./persistence.js`'s `onLoadDocument` does for a live
 * Hocuspocus connection, factored out so anything that needs a read-only snapshot of "the document as it
 * is right now" without actually opening a collab connection (blame, `WO-154`; version capture, `WO-156`;
 * restore, `WO-157`; comment-anchor resolution, `WO-158`) shares one implementation rather than several
 * slightly different re-derivations of the same replay logic.
 *
 * WO-223 (performance review, HIGH): every one of those callers used to invoke this fresh, replaying a
 * document's *entire* `doc_updates` history via `Y.applyUpdate` on every single call — blame in particular
 * runs on essentially every `blame:stale` broadcast during active editing. `createLiveYDocCache` now keeps
 * the reconstructed `Y.Doc` (plus the full attribution `updates` array blame/version-contributors need) in
 * process, keyed by document id, alongside the highest `doc_updates.seq` it reflects; a cache hit only
 * fetches and replays rows with `seq` strictly greater than that (`DocUpdatesRepository.listSinceSeq`,
 * WO-223) instead of the full history again. `reconstructLiveYDoc`'s signature is unchanged for every
 * existing caller — it now reads through {@link defaultLiveYDocCache} by default — so blame/restore/
 * versions/comments needed no changes of their own to benefit.
 *
 * Concurrency: reads for the same `documentId` are serialized through a per-document promise chain (same
 * reasoning as `./doc-update-writer.js`'s WO-222 per-document flush chain — the DB has no lock to protect
 * here, but two concurrent readers must never both replay the same catch-up rows onto the shared cached
 * `Y.Doc`, nor read `cached.seq` while another reader is mid-replay). Every current caller of this module
 * consumes the returned `ydoc` *synchronously*, with no `await` in between — an invariant future callers
 * must preserve, since the same mutable `Y.Doc` instance is shared across calls rather than cloned (cloning
 * would mean re-encoding/re-applying the whole document, defeating the point of caching it).
 *
 * Eviction: a document's cache entry is dropped whenever Hocuspocus loads or unloads it live
 * (`./persistence.js`'s `onLoadDocument`/`afterUnloadDocument`, mirroring WO-221's own `DocSizeTracker`
 * load/unload hooks) — on load, because a live session may apply content that never becomes its own
 * `doc_updates` row (e.g. WO-139's `pending_editable_patch`, applied directly to the live document) and
 * this cache must not keep serving a stale reconstruction from before that happened; on unload, so a
 * document nobody has open doesn't linger here forever.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import { createTenantDb, schema, withTenantTx, type DocUpdateRow, type DocUpdatesRepository } from '@prdm/db';
import { createDocumentYDoc } from '@prdm/collab';

export interface ReconstructedDocument {
  /** The shared, in-process-cached `Y.Doc` — never mutate it, and never `await` anything between
   * receiving it and finishing reading from it (see this module's own doc comment). */
  ydoc: Y.Doc;
  /** Every `doc_updates` row ever recorded for this document, oldest first — the full attribution
   * history, needed by blame's `RangeIndex` and by version capture's contributor computation alike. This
   * array (like `ydoc`) may be the same cached reference across calls — never mutate it. */
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

interface CacheEntry {
  ydoc: Y.Doc;
  updates: DocUpdateRow[];
  /** The highest `doc_updates.seq` reflected in `ydoc`/`updates` so far. */
  seq: number;
  hasLiveHistory: boolean;
}

export interface LiveYDocCache {
  get(pool: Pool, orgId: string, documentId: string): Promise<ReconstructedDocument>;
  /** Drops `documentId`'s cache entry (and its serialization chain) — see this module's own doc comment
   * for when this is called. Safe to call for a document with no entry (a no-op). */
  evict(documentId: string): void;
}

export interface CreateLiveYDocCacheOptions {
  /** Test seam only: overrides how `doc_updates` rows are fetched for a given `(pool, orgId)`, defaulting
   * to the real tenant-scoped repository (`createTenantDb(pool).forOrg(orgId).docUpdates`). Lets a test
   * count/bound how many rows a subsequent read fetches without needing to intercept the Postgres driver
   * directly. */
  docUpdatesRepositoryFor?: (pool: Pool, orgId: string) => DocUpdatesRepository;
}

async function reconstructFromScratch(pool: Pool, orgId: string, documentId: string, repository: DocUpdatesRepository): Promise<CacheEntry> {
  const documentRow = await withTenantTx(pool, orgId, async (tx) => {
    const [row] = await tx.select({ workingState: schema.documents.workingState, snapshotSeq: schema.documents.snapshotSeq }).from(schema.documents).where(eq(schema.documents.id, documentId));
    return row ?? null;
  });

  const ydoc = createDocumentYDoc();
  if (documentRow?.workingState) Y.applyUpdate(ydoc, documentRow.workingState);

  const updates = await repository.listForDocument(documentId);
  const snapshotSeq = documentRow?.snapshotSeq ?? 0;
  for (const row of updates) {
    if (row.seq > snapshotSeq) Y.applyUpdate(ydoc, row.update);
  }

  const hasLiveHistory = documentRow?.workingState != null || updates.length > 0;
  const seq = updates.length > 0 ? updates[updates.length - 1]!.seq : 0;
  return { ydoc, updates, seq, hasLiveHistory };
}

export function createLiveYDocCache(options: CreateLiveYDocCacheOptions = {}): LiveYDocCache {
  const repositoryFor = options.docUpdatesRepositoryFor ?? ((pool: Pool, orgId: string) => createTenantDb(pool).forOrg(orgId).docUpdates);
  const entries = new Map<string, CacheEntry>();
  // Per-document serialization (WO-222's own pattern) — see this module's own doc comment.
  const chains = new Map<string, Promise<unknown>>();

  function runExclusive<T>(documentId: string, fn: () => Promise<T>): Promise<T> {
    const prior = chains.get(documentId) ?? Promise.resolve();
    const result = prior.then(fn, fn);
    chains.set(
      documentId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  return {
    get(pool, orgId, documentId) {
      return runExclusive(documentId, async () => {
        const repository = repositoryFor(pool, orgId);
        const cached = entries.get(documentId);
        if (!cached) {
          const fresh = await reconstructFromScratch(pool, orgId, documentId, repository);
          entries.set(documentId, fresh);
          return { ydoc: fresh.ydoc, updates: fresh.updates, hasLiveHistory: fresh.hasLiveHistory };
        }

        const newRows = await repository.listSinceSeq(documentId, cached.seq);
        if (newRows.length > 0) {
          for (const row of newRows) Y.applyUpdate(cached.ydoc, row.update);
          cached.updates = cached.updates.concat(newRows);
          cached.seq = newRows[newRows.length - 1]!.seq;
          cached.hasLiveHistory = true;
        }
        return { ydoc: cached.ydoc, updates: cached.updates, hasLiveHistory: cached.hasLiveHistory };
      });
    },

    evict(documentId) {
      entries.delete(documentId);
      chains.delete(documentId);
    },
  };
}

/** The single shared cache every production call site (blame, restore, versions, comments) reads through
 * via {@link reconstructLiveYDoc}'s default parameter. `register-collab-route.ts`/`persistence.ts` hold
 * onto this same instance to evict entries on document load/unload. */
export const defaultLiveYDocCache: LiveYDocCache = createLiveYDocCache();

export async function reconstructLiveYDoc(pool: Pool, orgId: string, documentId: string, cache: LiveYDocCache = defaultLiveYDocCache): Promise<ReconstructedDocument> {
  return cache.get(pool, orgId, documentId);
}
