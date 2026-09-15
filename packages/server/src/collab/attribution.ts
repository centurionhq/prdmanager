/**
 * `beforeSync` for `/collab` (SDD-008 §"Autoría por línea no falsificable", WO-149): durably logs an
 * incoming update to `doc_updates`/`doc_client_bindings` — **not** `onChange`. Reading
 * `@hocuspocus/server` 4.7.0's own `readSyncMessage` (the ADR-006 learning test's own source of truth)
 * shows `handleDocumentUpdate`'s call to `this.hooks("onChange", ...)` is fire-and-forget: it does not
 * gate `Document.handleUpdate`'s broadcast, which runs synchronously right after the update is applied.
 * `beforeSync`, by contrast, is `await`ed by `readSyncMessage` *before* the `switch` that applies
 * SyncStep2/Update at all (confirmed by the same learning test) — so awaiting the durable write here is
 * what actually makes it happen before the update is ever applied or broadcast, matching SDD-008's
 * "escritos de forma durable ... antes de difundir" literally. This is a deliberate correction of this
 * WO's own prompt, which assumed `onChange` was the gating hook; flagged for the security review this
 * batch feeds into.
 *
 * Fires for every sync message type, including `SyncStep1` (a bare state-vector exchange, type 0 — no
 * update bytes to log, skipped) and, on a **read-only** connection, `SyncStep2`/`Update` too:
 * `readSyncMessage` awaits `beforeSync` unconditionally and only checks `connection.readOnly` *inside*
 * the switch, after this hook has already run — logging a read-only connection's attempted edit would
 * describe content that is never actually applied, so it's skipped here using the exact same
 * `connection.readOnly` check Hocuspocus itself uses to decide whether to apply it at all.
 */
import { decodeUpdateRanges } from '@prdm/collab';
import type { CollabDocumentContext } from './authenticate.js';
import type { DocUpdateBatcher, PendingDocUpdateRow } from './doc-update-writer.js';

const SYNC_STEP_1 = 0;

export interface CollabAttributionConnectionLike {
  readOnly: boolean;
  socketId: string;
}

export interface CollabAttributionPayload {
  type: number;
  payload: Uint8Array;
  context: Partial<CollabDocumentContext>;
  connection: CollabAttributionConnectionLike;
}

export interface CollabAttributionExtension {
  extensionName: string;
  beforeSync(data: CollabAttributionPayload): Promise<void>;
}

export interface CollabAttributionDeps {
  batcher: DocUpdateBatcher;
}

export function createCollabAttributionExtension(deps: CollabAttributionDeps): CollabAttributionExtension {
  const { batcher } = deps;

  return {
    extensionName: 'prdm-collab-attribution',

    async beforeSync(data) {
      if (data.type === SYNC_STEP_1) return;
      if (data.connection.readOnly) return;

      const { orgId, documentId, userId } = data.context;
      if (!orgId || !documentId) return;

      const { structRanges, deleteRanges } = decodeUpdateRanges(data.payload);

      const row: PendingDocUpdateRow = {
        update: Buffer.from(data.payload),
        structRanges,
        deleteRanges,
        actorKind: userId ? 'user' : 'system',
        userId: userId ?? null,
        onBehalfOf: null,
        agentId: null,
        connectionId: data.connection.socketId || null,
      };

      await batcher.enqueue(orgId, documentId, row);
    },
  };
}
