/**
 * WO-597 (SDD-008, follow-up to WO-596's fix) — deterministic regression coverage for the seed-journal
 * gap, without a live Hocuspocus/websocket connection: `doc_updates` rows are inserted directly by SQL,
 * the same technique `reconstruct-ydoc-cache.test.ts`'s own `seedEdit` and
 * `documents-agent-proposals.test.ts`'s `seedLiveBody`/`seedConcurrentEdit` already use.
 *
 * Before WO-596, `persistence.ts`'s `onLoadDocument` applied WO-447's template seed only to the live
 * in-memory `Y.Doc`, never journaling it to `doc_updates` — a real client edit made before the next
 * debounced `onStoreDocument` flush produced Yjs structs whose `left`/predecessor references pointed at
 * that unjournaled seed. `reconstructFromScratch` (`reconstruct-ydoc.ts`), replaying `doc_updates` alone
 * onto a *fresh* `Y.Doc` with no `working_state` snapshot, could never resolve those structs' missing
 * dependencies, so the reconstruction silently came out incomplete. This file reproduces exactly that
 * shape directly against Postgres: a "seed" row (what WO-596 now journals) followed by an "edit" row
 * whose Yjs structs are built on top of that same shared document reference — then asserts a fresh-cache
 * `reconstructLiveYDoc` call sees the complete result.
 */
import * as Y from 'yjs';
import { createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createLiveYDocCache, reconstructLiveYDoc } from '../../src/collab/reconstruct-ydoc.js';
import { insertCollabDocumentFixture } from './document-fixture.js';

/** Inserts a `doc_updates` row built as a diff off `shared`'s current state, then advances `shared` to
 * match -- mirrors `reconstruct-ydoc-cache.test.ts`'s own `seedEdit`, parameterized by `actorKind` since
 * this file's whole point is distinguishing the seed row (`'system'`) from a real edit (also `'system'`
 * here, since no live user/session is involved -- what matters is the *dependency chain*, not the actor). */
async function insertUpdate(pg: PgTestDb, shared: Y.Doc, params: { orgId: string; documentId: string; seq: number }, mutate: (doc: Y.Doc) => void): Promise<void> {
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

describe('reconstructLiveYDoc across the WO-596 seed-journal gap (SDD-008, WO-597)', () => {
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

  test('a from-scratch reconstruction resolves an edit built on top of a journaled seed, with working_state still null', async () => {
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const shared = new Y.Doc({ gc: false });

    // Row 1: the seed WO-596 now journals -- a fresh Y.Doc's own initial state, exactly what
    // `onLoadDocument`'s `seedFromMarkdown` + the new `writeDocUpdateBatch` call would produce.
    await insertUpdate(pg, shared, { orgId: org.id, documentId, seq: 1 }, (doc) => doc.getText('body').insert(0, '## Resumen\n\nSeeded body.'));

    // Row 2: a real edit, its Yjs structs built as a diff *on top of* the same shared reference -- their
    // `left`/predecessor structs live in row 1. This is the shape a live client produces once WO-596's
    // journal write has happened; without it, `reconstructFromScratch` had nothing to resolve against.
    await insertUpdate(pg, shared, { orgId: org.id, documentId, seq: 2 }, (doc) => doc.getText('body').insert(doc.getText('body').length, ' Edited before flush.'));

    const { rows } = await pg.ownerPool.query(`SELECT working_state FROM documents WHERE id = $1`, [documentId]);
    expect(rows[0].working_state).toBeNull();

    const reconstructed = await reconstructLiveYDoc(pg.appPool, org.id, documentId, createLiveYDocCache());
    expect(reconstructed.ydoc.getText('body').toString()).toBe('## Resumen\n\nSeeded body. Edited before flush.');
    expect(reconstructed.hasLiveHistory).toBe(true);
  });

  test('a document with a real working_state snapshot is unaffected -- reconstructFromScratch never needs a seed once one exists', async () => {
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const shared = new Y.Doc({ gc: false });
    await insertUpdate(pg, shared, { orgId: org.id, documentId, seq: 1 }, (doc) => doc.getText('body').insert(0, 'real content, no template seed involved'));

    // A `working_state` snapshot exists (as it would after any real `onStoreDocument` flush) --
    // `snapshot_seq` advances to match, so `reconstructFromScratch` has nothing left to replay past it.
    await pg.ownerPool.query(`UPDATE documents SET working_state = $1, snapshot_seq = 1 WHERE id = $2`, [Buffer.from(Y.encodeStateAsUpdate(shared)), documentId]);

    const reconstructed = await reconstructLiveYDoc(pg.appPool, org.id, documentId, createLiveYDocCache());
    expect(reconstructed.ydoc.getText('body').toString()).toBe('real content, no template seed involved');
  });
});
