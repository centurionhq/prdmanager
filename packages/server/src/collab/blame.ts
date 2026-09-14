/**
 * Live blame (SDD-008 §"Autoría por línea no falsificable" / §"Endpoint de blame y mensaje stateless
 * blame:stale"): reconstructs a document's current `Y.Doc` and full `doc_updates`-derived `RangeIndex`
 * exactly the way `./persistence.js`'s `onLoadDocument` does (decode `working_state`, replay every
 * `doc_updates` row past `snapshot_seq`), then calls `@prdm/collab`'s pure `computeBlame`.
 *
 * Recomputing this on every request would mean re-decoding a document's entire Yjs history per call, so
 * {@link createBlameCache} memoizes by `doc_updates`' own highest `seq` for the document — cheap to poll
 * (`maxSeqForDocument`, an indexed `ORDER BY seq DESC LIMIT 1`) — and only rebuilds the `Y.Doc`/index when
 * that number has moved since the last computation. `createBlameBroadcastExtension`'s `onStoreDocument`
 * hook is a *separate* concern: it tells already-connected clients (WO-161's gutter) to refetch, entirely
 * independent of whether this process's own cache happens to be warm.
 */
import type { Pool } from 'pg';
import { createTenantDb } from '@prdm/db';
import { buildRangeIndex, computeBlame, type BlameResult } from '@prdm/collab';
import { reconstructLiveYDoc } from './reconstruct-ydoc.js';

export interface BlameCache {
  /** Recomputes only if `doc_updates`' highest `seq` for `documentId` has changed since the last call. */
  get(pool: Pool, orgId: string, documentId: string): Promise<BlameResult>;
}

async function computeLiveBlame(pool: Pool, orgId: string, documentId: string): Promise<BlameResult> {
  const { ydoc, updates } = await reconstructLiveYDoc(pool, orgId, documentId);

  const index = buildRangeIndex(
    updates.map((row) => ({
      structRanges: row.structRanges,
      deleteRanges: row.deleteRanges,
      // `actorKind` is nullable only at the schema level for rows a future migration might backfill
      // oddly — every row this codebase's own writer produces always sets it (`doc-update-writer.ts`).
      actorKind: row.actorKind ?? 'system',
      userId: row.userId,
      onBehalfOf: row.onBehalfOf,
      agentId: row.agentId,
      receivedAt: row.receivedAt,
    })),
  );

  return computeBlame(ydoc, index);
}

export function createBlameCache(): BlameCache {
  const cache = new Map<string, { seq: number; result: BlameResult }>();

  return {
    async get(pool, orgId, documentId) {
      const maxSeq = await createTenantDb(pool).forOrg(orgId).docUpdates.maxSeqForDocument(documentId);
      const cached = cache.get(documentId);
      if (cached && cached.seq === maxSeq) return cached.result;

      const result = await computeLiveBlame(pool, orgId, documentId);
      cache.set(documentId, { seq: maxSeq, result });
      return result;
    },
  };
}

/** Matches just the slice of `@hocuspocus/server`'s `Document`/`onStoreDocumentPayload` this extension
 * needs (same structural-typing reasoning as `./persistence.js`'s `CollabPersistenceExtension`). */
export interface BlameBroadcastExtension {
  extensionName: string;
  onStoreDocument(data: { document: { broadcastStateless(payload: string): void } }): Promise<void>;
}

export const BLAME_STALE_MESSAGE = JSON.stringify({ type: 'blame:stale' });

/** SDD-008: "aviso blame:stale por mensaje stateless tras cada store" — every already-connected client
 * (regardless of who caused the store) is told its cached blame is stale and should refetch WO-154's
 * endpoint; the stateless channel is server -> client only (WO-151), so there is nothing for a client to
 * ack or reply with. */
export function createBlameBroadcastExtension(): BlameBroadcastExtension {
  return {
    extensionName: 'prdm-collab-blame-broadcast',
    async onStoreDocument({ document }) {
      document.broadcastStateless(BLAME_STALE_MESSAGE);
    },
  };
}
