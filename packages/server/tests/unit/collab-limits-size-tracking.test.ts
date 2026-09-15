/**
 * WO-221 — unit tests proving `createCollabLimitsExtension`'s encoded-state-size check reads an
 * incrementally-tracked byte counter (`../../src/collab/doc-size-tracker.js`) rather than recomputing
 * `Y.encodeStateAsUpdate(document).byteLength` on every `beforeSync` call. No Postgres, no Hocuspocus —
 * a fake pool (only ever touched on a rejection's audit-log side effect, never exercised by these tests)
 * and a fake clock, exactly the `unit/` tier's own convention (see `rate-limit.test.ts`).
 *
 * Rather than spying on `yjs`'s own exports (fragile across ESM/bundler boundaries), these tests prove
 * the counter is authoritative by making it disagree with the document's *real* encoded size: if
 * `beforeSync` still called `Y.encodeStateAsUpdate` under the hood, its accept/reject decision would track
 * the document's real size, not the injected counter's — these tests would fail either way that happened.
 */
import * as Y from 'yjs';
import type { Pool } from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { BODY_ROOT } from '@prdm/collab';
import { createCollabLimitsExtension, type CollabLimitsBeforeSyncPayload, type CollabLimitsConnectionLike } from '../../src/collab/limits.js';
import { createDocSizeTracker } from '../../src/collab/doc-size-tracker.js';

const BASE_LIMITS = {
  maxRenderedBytes: 10_000_000,
  maxEncodedStateBytes: 1_000,
  maxConnectionsPerUser: 100,
  maxConnectionsPerDocument: 100,
  maxUpdatesPerSecPerUser: 100_000,
  maxUpdatesPerSecPerDocument: 100_000,
};

function fakePool(): Pool {
  return { query: vi.fn() } as unknown as Pool;
}

function fakeConnection(): CollabLimitsConnectionLike {
  return { readOnly: false, close: vi.fn(), context: {} };
}

function makePayload(document: Y.Doc, documentId: string): CollabLimitsBeforeSyncPayload {
  return {
    type: 2, // an Update message, never SyncStep1 (which beforeSync always ignores)
    document,
    context: { userId: 'user-1', orgId: 'org-1', projectId: 'project-1', documentId },
    connection: fakeConnection(),
  };
}

describe('createCollabLimitsExtension size check reads the tracker, not the live Y.Doc (unit, WO-221)', () => {
  test('accepts an update on a document whose real encoded size is already over the limit, when the tracker reports it under the limit', async () => {
    const sizeTracker = createDocSizeTracker();
    const documentId = 'doc-under-per-tracker';
    sizeTracker.seed(documentId, 10); // far under maxEncodedStateBytes

    const document = new Y.Doc({ gc: false });
    // Real encoded size is deliberately pushed well past `maxEncodedStateBytes` — if `beforeSync` still
    // recomputed this, the update below would be rejected.
    document.getText(BODY_ROOT).insert(0, 'x'.repeat(5_000));
    expect(Y.encodeStateAsUpdate(document).byteLength).toBeGreaterThan(BASE_LIMITS.maxEncodedStateBytes);

    const extension = createCollabLimitsExtension({ pool: fakePool(), clock: () => new Date(0), limits: BASE_LIMITS, sizeTracker });
    await expect(extension.beforeSync(makePayload(document, documentId))).resolves.toBeUndefined();
  });

  test('rejects an update on a document whose real encoded size is tiny, when the tracker reports it over the limit', async () => {
    const sizeTracker = createDocSizeTracker();
    const documentId = 'doc-over-per-tracker';
    sizeTracker.seed(documentId, BASE_LIMITS.maxEncodedStateBytes + 1);

    const document = new Y.Doc({ gc: false });
    document.getText(BODY_ROOT).insert(0, 'tiny');
    expect(Y.encodeStateAsUpdate(document).byteLength).toBeLessThan(BASE_LIMITS.maxEncodedStateBytes);

    const extension = createCollabLimitsExtension({ pool: fakePool(), clock: () => new Date(0), limits: BASE_LIMITS, sizeTracker });
    await expect(extension.beforeSync(makePayload(document, documentId))).rejects.toThrow(/maximum encoded state size/);
  });

  test('reads the tracker exactly once per beforeSync call regardless of how much history the document has accumulated', async () => {
    const sizeTracker = createDocSizeTracker();
    const getSpy = vi.spyOn(sizeTracker, 'get');
    const documentId = 'doc-many-edits';
    sizeTracker.seed(documentId, 0);

    const document = new Y.Doc({ gc: false });
    const extension = createCollabLimitsExtension({ pool: fakePool(), clock: () => new Date(0), limits: BASE_LIMITS, sizeTracker });

    const editCount = 25;
    for (let i = 0; i < editCount; i += 1) {
      document.getText(BODY_ROOT).insert(0, 'a');
      // Simulates `doc-update-writer.ts` incrementing the tracker as each edit's batch commits.
      sizeTracker.addBytes(documentId, 1);
      await extension.beforeSync(makePayload(document, documentId));
    }

    // O(1) per call: exactly one `get` per `beforeSync`, never growing with the document's own history size.
    expect(getSpy).toHaveBeenCalledTimes(editCount);
  });
});
