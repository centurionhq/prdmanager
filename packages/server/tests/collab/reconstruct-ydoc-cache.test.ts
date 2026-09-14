/**
 * WO-223 — blame, restore, and comment-anchor resolution all reconstruct a document's live `Y.Doc` via
 * `reconstructLiveYDoc` (`../../src/collab/reconstruct-ydoc.js`), and none of them used to cache the
 * result: every call replayed the document's *entire* `doc_updates` history from scratch. These tests
 * prove the in-process cache added by this WO (1) produces byte-for-byte identical content to a full
 * from-scratch reconstruction after an incremental catch-up, and (2) actually bounds the work a cache hit
 * does to "rows written since the last read", not "total history" — via a counting wrapper around the
 * repository (this suite's own precedent-free but self-contained query-counting seam, since no existing
 * test in this repo counts repository calls; see WO-224's own test for the same technique applied to a
 * different repository).
 */
import * as Y from 'yjs';
import { createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import type { DocUpdatesRepository } from '@prdm/db';
import { createTenantDb } from '@prdm/db';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLiveYDocCache, reconstructLiveYDoc } from '../../src/collab/reconstruct-ydoc.js';
import { insertCollabDocumentFixture } from './document-fixture.js';

/** Appends one more `doc_updates` row on top of `shared`'s running state — mirrors `restore-race.test.ts`'s
 * own `seedEdit` helper, kept local since that file lives in a different describe's scope. */
async function seedEdit(pg: PgTestDb, shared: Y.Doc, params: { orgId: string; documentId: string; seq: number }, mutate: (doc: Y.Doc) => void): Promise<void> {
  const clientDoc = new Y.Doc({ gc: false });
  Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(shared));
  const before = Y.encodeStateVector(clientDoc);
  mutate(clientDoc);
  const update = Buffer.from(Y.encodeStateAsUpdate(clientDoc, before));
  Y.applyUpdate(shared, update);
  await pg.ownerPool.query(`INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, struct_ranges, delete_ranges, update) VALUES ($1, $2, $3, 'system', '[]', '[]', $4)`, [
    params.orgId,
    params.documentId,
    params.seq,
    update,
  ]);
}

function countingRepository(real: DocUpdatesRepository): { repo: DocUpdatesRepository; listForDocumentCalls: number[]; listSinceSeqCalls: number[] } {
  const listForDocumentCalls: number[] = [];
  const listSinceSeqCalls: number[] = [];
  return {
    listForDocumentCalls,
    listSinceSeqCalls,
    repo: {
      listForDocument: async (documentId) => {
        const rows = await real.listForDocument(documentId);
        listForDocumentCalls.push(rows.length);
        return rows;
      },
      listSinceSeq: async (documentId, sinceSeq) => {
        const rows = await real.listSinceSeq(documentId, sinceSeq);
        listSinceSeqCalls.push(rows.length);
        return rows;
      },
      maxSeqForDocument: real.maxSeqForDocument,
    },
  };
}

describe('reconstructLiveYDoc in-process cache (SDD-008, WO-223)', () => {
  let pg: PgTestDb;
  let org: { id: string };
  let project: { id: string };

  beforeAll(async () => {
    pg = await openTestPg();
    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
  });

  afterAll(async () => {
    await pg.close();
  });

  test('an incremental catch-up produces content identical to a full from-scratch reconstruction', async () => {
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const shared = new Y.Doc({ gc: false });

    for (let i = 1; i <= 10; i += 1) {
      await seedEdit(pg, shared, { orgId: org.id, documentId, seq: i }, (doc) => doc.getText('body').insert(doc.getText('body').length, `line ${i}\n`));
    }

    const cache = createLiveYDocCache();
    const first = await reconstructLiveYDoc(pg.appPool, org.id, documentId, cache);
    expect(first.ydoc.getText('body').toString()).toBe(shared.getText('body').toString());

    // More history accrues after the first (now-cached) read.
    for (let i = 11; i <= 15; i += 1) {
      await seedEdit(pg, shared, { orgId: org.id, documentId, seq: i }, (doc) => doc.getText('body').insert(doc.getText('body').length, `line ${i}\n`));
    }

    const second = await reconstructLiveYDoc(pg.appPool, org.id, documentId, cache); // incremental catch-up
    const fromScratch = await reconstructLiveYDoc(pg.appPool, org.id, documentId, createLiveYDocCache()); // full rebuild, fresh cache

    expect(second.ydoc.getText('body').toString()).toBe(fromScratch.ydoc.getText('body').toString());
    expect(second.ydoc.getText('body').toString()).toBe(shared.getText('body').toString());
    expect(second.updates.length).toBe(15);
    expect(second.hasLiveHistory).toBe(true);
  });

  test('a cache hit fetches only rows written since the last read, never the full history again', async () => {
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const shared = new Y.Doc({ gc: false });
    const HISTORY_SIZE = 300;
    for (let i = 1; i <= HISTORY_SIZE; i += 1) {
      await seedEdit(pg, shared, { orgId: org.id, documentId, seq: i }, (doc) => doc.getText('body').insert(doc.getText('body').length, 'x'));
    }

    const real = createTenantDb(pg.appPool).forOrg(org.id).docUpdates;
    const counting = countingRepository(real);
    const cache = createLiveYDocCache({ docUpdatesRepositoryFor: () => counting.repo });

    await reconstructLiveYDoc(pg.appPool, org.id, documentId, cache);
    expect(counting.listForDocumentCalls).toEqual([HISTORY_SIZE]); // one full reconstruction
    expect(counting.listSinceSeqCalls).toEqual([]);

    const NEW_ROWS = 4;
    for (let i = HISTORY_SIZE + 1; i <= HISTORY_SIZE + NEW_ROWS; i += 1) {
      await seedEdit(pg, shared, { orgId: org.id, documentId, seq: i }, (doc) => doc.getText('body').insert(doc.getText('body').length, 'y'));
    }

    await reconstructLiveYDoc(pg.appPool, org.id, documentId, cache);
    // Bounded by what's new since the last read — never re-fetches (or re-replays) the full history.
    expect(counting.listForDocumentCalls).toEqual([HISTORY_SIZE]);
    expect(counting.listSinceSeqCalls).toEqual([NEW_ROWS]);
  });

  test('evict forces the next read to do a full reconstruction again', async () => {
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const shared = new Y.Doc({ gc: false });
    for (let i = 1; i <= 3; i += 1) {
      await seedEdit(pg, shared, { orgId: org.id, documentId, seq: i }, (doc) => doc.getText('body').insert(0, 'a'));
    }

    const real = createTenantDb(pg.appPool).forOrg(org.id).docUpdates;
    const counting = countingRepository(real);
    const cache = createLiveYDocCache({ docUpdatesRepositoryFor: () => counting.repo });

    await reconstructLiveYDoc(pg.appPool, org.id, documentId, cache);
    expect(counting.listForDocumentCalls.length).toBe(1);

    cache.evict(documentId);
    await reconstructLiveYDoc(pg.appPool, org.id, documentId, cache);
    expect(counting.listForDocumentCalls.length).toBe(2); // evicted -> full reconstruction again, not a catch-up
    expect(counting.listSinceSeqCalls).toEqual([]);
  });
});
