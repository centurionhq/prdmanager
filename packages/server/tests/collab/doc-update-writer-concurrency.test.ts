/**
 * WO-222 — the durable write queue (`../../src/collab/doc-update-writer.js`) must serialize a document's
 * writes only against *itself*, matching the DB-level `pg_advisory_xact_lock` (keyed by `documentId`)
 * that already provides per-document correctness — not against every other document's writes via a single
 * server-wide chain. `writeBatch` is injected here (defaulting to the real `writeDocUpdateBatch`) purely
 * so this test can hold one document's write open with a manually-resolved gate — never a real `setTimeout`
 * — while asserting a second, unrelated document's write completes regardless.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createFakeCollabBatchScheduler } from '../../src/collab/batch-scheduler.js';
import { createDocUpdateBatcher, writeDocUpdateBatch, type PendingDocUpdateRow } from '../../src/collab/doc-update-writer.js';
import { seedUser } from '../helpers/seed-auth.js';
import { ISOLATION_TEST_ENV } from '../isolation/fixtures.js';
import { insertCollabDocumentFixture } from './document-fixture.js';

function fakeRow(overrides: Partial<PendingDocUpdateRow> = {}): PendingDocUpdateRow {
  return {
    update: Buffer.from([1, 2, 3]),
    structRanges: [],
    deleteRanges: [],
    actorKind: 'user',
    userId: null,
    onBehalfOf: null,
    agentId: null,
    connectionId: null,
    ...overrides,
  };
}

/** A promise this test resolves manually, standing in for "document A's write is still running" without
 * ever waiting out real wall-clock time. */
function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('doc-update-writer per-document write serialization (SDD-008, WO-222)', () => {
  let pg: PgTestDb;
  let org: { id: string };
  let project: { id: string };
  let userId: string;

  beforeAll(async () => {
    pg = await openTestPg();
    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
    const user = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'owner' });
    userId = user.id;
  });

  afterAll(async () => {
    await pg.close();
  });

  test("document B's write completes without waiting on document A's slow write", async () => {
    const scheduler = createFakeCollabBatchScheduler();
    const docA = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const docB = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const gate = createGate();
    const batcher = createDocUpdateBatcher({
      pool: pg.appPool,
      scheduler,
      writeBatch: async (pool, orgId, documentId, rows) => {
        if (documentId === docA) await gate.promise; // held open by the test, never a real timer
        await writeDocUpdateBatch(pool, orgId, documentId, rows);
      },
    });

    let bResolvedWhileAStillGated = false;
    const aFlushed = batcher.enqueue(org.id, docA, fakeRow({ userId }));
    const bFlushed = batcher.enqueue(org.id, docB, fakeRow({ userId })).then(() => {
      bResolvedWhileAStillGated = true;
    });

    // Fires both documents' pending batch-window timeouts in one go: document A's flush starts and
    // immediately blocks on the gate; document B's flush — a *separate* chain, per this WO — must not be
    // blocked by that.
    scheduler.flushAll();

    await bFlushed;
    expect(bResolvedWhileAStillGated).toBe(true);

    // Document A's own write is still pending until the gate is released — proves the delay was real
    // (not a no-op), so document B's early completion above is meaningful.
    let aResolved = false;
    aFlushed.then(() => {
      aResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(aResolved).toBe(false);

    gate.release();
    await aFlushed;

    const rows = await pg.ownerPool.query<{ document_id: string }>(`SELECT document_id FROM doc_updates WHERE document_id = ANY($1)`, [[docA, docB]]);
    expect(rows.rows.length).toBe(2);
  });

  test('evictDocument removes a document from the per-document chain map without disturbing others', async () => {
    const scheduler = createFakeCollabBatchScheduler();
    const docA = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const docB = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const batcher = createDocUpdateBatcher({ pool: pg.appPool, scheduler });

    const aFlushed = batcher.enqueue(org.id, docA, fakeRow({ userId }));
    scheduler.flushAll();
    await aFlushed;

    batcher.evictDocument(docA);

    // Still works after eviction — a fresh chain is simply started on the next write.
    const aAgain = batcher.enqueue(org.id, docA, fakeRow({ userId, update: Buffer.from([9]) }));
    const bFlushed = batcher.enqueue(org.id, docB, fakeRow({ userId }));
    scheduler.flushAll();
    await Promise.all([aAgain, bFlushed]);

    const rows = await pg.ownerPool.query<{ document_id: string; seq: number }>(`SELECT document_id, seq FROM doc_updates WHERE document_id = $1 ORDER BY seq`, [docA]);
    expect(rows.rows.map((r) => r.seq)).toEqual([1, 2]);
  });
});
