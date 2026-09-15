/**
 * WO-149 — tests for `doc_updates`/`doc_client_bindings` attribution (SDD-008 §"Autoría por línea no
 * falsificable"): a pure batcher test against a real Postgres test database (no Hocuspocus involved,
 * for a deterministic look at batching/seq-allocation) plus a real Fastify + `HocuspocusProvider`
 * integration test proving the wiring end to end. Both use a fake, manually-flushed
 * `CollabBatchScheduler` (`../../src/collab/batch-scheduler.js`) — the ≤50ms write-batching window is
 * closed by calling `flushAll()`, never by waiting out a real timer.
 */
import { randomUUID } from 'node:crypto';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { createFakeCollabBatchScheduler, type FakeCollabBatchScheduler } from '../../src/collab/batch-scheduler.js';
import { createDocUpdateBatcher, type PendingDocUpdateRow } from '../../src/collab/doc-update-writer.js';
import { seedUser } from '../helpers/seed-auth.js';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceSynced, startCollabApp } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;
type Provider = ReturnType<typeof makeCollabProvider>;

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

describe('doc-update-writer batcher (SDD-008, WO-149)', () => {
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

  test('coalesces multiple enqueue calls for the same document into one flush with monotonic seqs', async () => {
    const scheduler = createFakeCollabBatchScheduler();
    const batcher = createDocUpdateBatcher({ pool: pg.appPool, scheduler });
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    let resolvedCount = 0;
    const promises = [1, 2, 3].map((n) =>
      batcher.enqueue(org.id, doc, fakeRow({ update: Buffer.from([n]), userId })).then(() => {
        resolvedCount += 1;
      }),
    );

    // Nothing is written (or resolved) until the batch window closes.
    await Promise.resolve();
    expect(resolvedCount).toBe(0);

    scheduler.flushAll();
    await Promise.all(promises);
    expect(resolvedCount).toBe(3);

    const rows = await pg.ownerPool.query<{ seq: number; actor_kind: string; user_id: string }>(
      `SELECT seq, actor_kind, user_id FROM doc_updates WHERE document_id = $1 ORDER BY seq`,
      [doc],
    );
    expect(rows.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.rows.every((r) => r.actor_kind === 'user' && r.user_id === userId)).toBe(true);
  });

  test('continues seq allocation across two separate batch windows for the same document', async () => {
    const scheduler = createFakeCollabBatchScheduler();
    const batcher = createDocUpdateBatcher({ pool: pg.appPool, scheduler });
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const firstBatch = Promise.all([1, 2].map((n) => batcher.enqueue(org.id, doc, fakeRow({ update: Buffer.from([n]), userId }))));
    scheduler.flushAll();
    await firstBatch;

    const secondBatch = batcher.enqueue(org.id, doc, fakeRow({ update: Buffer.from([3]), userId }));
    scheduler.flushAll();
    await secondBatch;

    const rows = await pg.ownerPool.query<{ seq: number }>(`SELECT seq FROM doc_updates WHERE document_id = $1 ORDER BY seq`, [doc]);
    expect(rows.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  test('inserts a first-writer-wins doc_client_bindings row per new client id in a user-authored update', async () => {
    const scheduler = createFakeCollabBatchScheduler();
    const batcher = createDocUpdateBatcher({ pool: pg.appPool, scheduler });
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const flushed = batcher.enqueue(org.id, doc, fakeRow({ structRanges: [{ client: 42, from: 0, to: 5 }], userId }));
    scheduler.flushAll();
    await flushed;

    const rows = await pg.ownerPool.query<{ client_id: string; user_id: string }>(`SELECT client_id, user_id FROM doc_client_bindings WHERE document_id = $1`, [doc]);
    expect(rows.rows).toEqual([{ client_id: '42', user_id: userId }]);
  });
});

const startApp = startCollabApp;

describe('/collab doc_updates attribution end to end (SDD-008, WO-149)', () => {
  let pg: PgTestDb;
  let app: BuiltApp;
  let url: string;
  let org: { id: string };
  let project: { id: string };
  let editor: { id: string; cookie: string };
  const providers: Provider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    // Deliberately the *real* batch scheduler here (never the fake one): this describe block proves
    // the actual wire-level ordering (durable write strictly before the server ever applies/broadcasts
    // an update), which only a real timer's completion can genuinely demonstrate — the fake scheduler
    // from the pure batcher tests above is for deterministic control over *when* a flush happens, not
    // for proving *that* one happens before something else does.
    const started = await startApp({ pool: pg.appPool });
    app = started.app;
    url = started.url;

    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
    const editorUser = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: editorUser.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editorUser.id, org.id]);
    const cookie = await signIn(app, editorUser.email);
    editor = { id: editorUser.id, cookie };
  });

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) provider.destroy();
  });

  test('an edit is durably written to doc_updates and bound to the editing user before it broadcasts', async () => {
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const writer = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    const reader = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(writer, reader);
    await Promise.all([onceSynced(writer), onceSynced(reader)]);

    const marker = randomUUID();
    const broadcastReceived = new Promise<void>((resolve) => {
      reader.document.getText('body').observe(function handler() {
        if (reader.document.getText('body').toString() === marker) {
          reader.document.getText('body').unobserve(handler);
          resolve();
        }
      });
    });
    writer.document.getText('body').insert(0, marker);

    // The reader only ever observes the broadcast once the server has applied the update — which,
    // since attribution.ts's durable write runs in `beforeSync` (awaited *before* Hocuspocus applies or
    // broadcasts anything — see that module's own doc comment on why `onChange` was the wrong hook),
    // can only happen after the row is already committed.
    await broadcastReceived;

    const rows = await pg.ownerPool.query<{ actor_kind: string; user_id: string; connection_id: string | null }>(
      `SELECT actor_kind, user_id, connection_id FROM doc_updates WHERE document_id = $1`,
      [doc],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.actor_kind === 'user' && r.user_id === editor.id && r.connection_id)).toBe(true);

    const clientId = String(writer.document.clientID);
    const bindings = await pg.ownerPool.query<{ client_id: string; user_id: string }>(`SELECT client_id, user_id FROM doc_client_bindings WHERE document_id = $1`, [doc]);
    expect(bindings.rows.some((b) => b.client_id === clientId && b.user_id === editor.id)).toBe(true);
  });
});
