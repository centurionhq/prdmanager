/**
 * In-memory running total of a document's encoded Yjs state size (SDD-008 §"Servidor de tiempo real",
 * WO-152 performance follow-up WO-221): replaces recomputing `Y.encodeStateAsUpdate(document).byteLength`
 * on every `beforeSync` (an O(total accumulated history) operation, since `gc: false` keeps every
 * tombstone forever, running unthrottled on essentially every edit batch a client sends) with an O(1)
 * counter read.
 *
 * Seeded once per document load (`./persistence.js`'s `onLoadDocument`) from the document's actual current
 * encoded size — so a server restart never silently resets a near-the-limit document's counter back to
 * zero — then incremented by `./doc-update-writer.js` as each batch of `doc_updates` durably commits (it
 * already knows the exact byte length of the update it just wrote, without any extra encoding work).
 * Evicted on `afterUnloadDocument` (`./persistence.js`) so a document nobody has open doesn't linger here
 * forever.
 */
export interface DocSizeTracker {
  /** `0` for a document never seeded — should not normally happen, since `onLoadDocument` always seeds a
   * document before any `beforeSync` for that same document can possibly run. */
  get(documentId: string): number;
  /** Overwrites the running total — used once per document load, from the actual encoded size. */
  seed(documentId: string, bytes: number): void;
  /** Adds to the running total — used each time a batch of updates durably commits. */
  addBytes(documentId: string, bytes: number): void;
  delete(documentId: string): void;
}

export function createDocSizeTracker(): DocSizeTracker {
  const sizes = new Map<string, number>();
  return {
    get: (documentId) => sizes.get(documentId) ?? 0,
    seed: (documentId, bytes) => {
      sizes.set(documentId, bytes);
    },
    addBytes: (documentId, bytes) => {
      sizes.set(documentId, (sizes.get(documentId) ?? 0) + bytes);
    },
    delete: (documentId) => {
      sizes.delete(documentId);
    },
  };
}
