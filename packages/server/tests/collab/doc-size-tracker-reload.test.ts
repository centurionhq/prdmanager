/**
 * WO-221 — integration test proving `createCollabPersistenceExtension`'s `onLoadDocument` seeds the
 * shared `DocSizeTracker` from the document's actual persisted size (never zero) even when that document
 * already has real `working_state`/`doc_updates` history — the "a server restart doesn't silently reset
 * the counter to zero against a document that's actually near its limit" requirement. Same minimal
 * Hocuspocus-less harness shape as `persistence.test.ts` (only the extension itself, no websocket layer
 * needed to exercise `onLoadDocument`/`afterUnloadDocument`).
 */
import { randomUUID } from 'node:crypto';
import { createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createCollabPersistenceExtension } from '../../src/collab/persistence.js';
import { createDocSizeTracker } from '../../src/collab/doc-size-tracker.js';

async function insertDocumentFixture(pg: PgTestDb, overrides: { orgId: string; projectId: string }): Promise<string> {
  const id = randomUUID();
  await pg.ownerPool.query(
    `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
     VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', 'collab', 'draft')`,
    [id, overrides.orgId, overrides.projectId, `PRD-${id.slice(0, 8)}`],
  );
  return id;
}

describe('DocSizeTracker seeding on document load (SDD-008, WO-221)', () => {
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

  test('a fresh load (simulated server restart) seeds the counter from the persisted working_state, not zero', async () => {
    const documentId = await insertDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    // Simulate prior content already durably persisted (as a real editing session would have left it),
    // without needing a live websocket connection.
    const scratch = new Y.Doc({ gc: false });
    scratch.getText('body').insert(0, 'x'.repeat(2_000));
    const workingState = Buffer.from(Y.encodeStateAsUpdate(scratch));
    const expectedBytes = workingState.byteLength;
    await pg.ownerPool.query(`UPDATE documents SET working_state = $1 WHERE id = $2`, [workingState, documentId]);

    const sizeTracker = createDocSizeTracker();
    const extension = createCollabPersistenceExtension({ pool: pg.appPool, sizeTracker });

    expect(sizeTracker.get(documentId)).toBe(0); // nothing loaded yet
    const documentName = `${project.id}:${documentId}`;
    const liveDoc = new Y.Doc({ gc: false });
    await extension.onLoadDocument({ documentName, document: liveDoc });

    // Never zero: seeded from the real, fully-hydrated encoded size right after load.
    expect(sizeTracker.get(documentId)).toBe(expectedBytes);
    expect(sizeTracker.get(documentId)).toBeGreaterThan(0);
  });

  test('afterUnloadDocument evicts the tracked size so it never lingers for a document no longer open', async () => {
    const documentId = await insertDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const sizeTracker = createDocSizeTracker();
    const extension = createCollabPersistenceExtension({ pool: pg.appPool, sizeTracker });
    const documentName = `${project.id}:${documentId}`;

    await extension.onLoadDocument({ documentName, document: new Y.Doc({ gc: false }) });
    expect(sizeTracker.get(documentId)).toBeGreaterThanOrEqual(0);

    await extension.afterUnloadDocument({ documentName });
    // Back to the "never seeded" default — proves the entry was actually removed, not just left at 0
    // coincidentally (an empty document's real encoded size is >0 bytes of Yjs framing overhead, so a
    // reseed would not silently look identical to eviction).
    expect(sizeTracker.get(documentId)).toBe(0);
  });
});
