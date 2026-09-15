/**
 * WO-218 — security review #2 (HIGH): a version restore's `doc_updates`/`doc_client_bindings` write must
 * be durable *before* the restored content is applied to the live `Y.Doc` and broadcast, exactly like
 * `./attribution.test.ts` already proves for the normal live-edit path via `beforeSync`. A Hocuspocus
 * direct connection's `transact` never runs `beforeSync` (confirmed against the installed
 * `@hocuspocus/server` 4.7.0 source — see `../../src/collab/restore.js`'s own doc comment), so
 * `restore.js` must enforce the same ordering itself.
 *
 * The first test below proves that ordering *deterministically* (no timing/race dependency): it swaps in
 * a fake `Hocuspocus` whose `openDirectConnection().transact` — the one moment `restore.js` ever mutates
 * the live document — synchronously checks whether the durable attribution row already exists in
 * Postgres. Since `restoreDocumentVersion` is single-threaded, straight-line code, whichever of "write
 * DB" vs. "call transact" it does first is always observed the same way, every run, independent of how
 * fast Postgres happens to respond.
 *
 * The second test covers the race the review specifically asked for: a normal client's WS edit landing
 * at the same time as a restore of the same document must never be misattributed, dropped, or crash
 * either side.
 */
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createDocumentYDoc, decodeUpdateRanges } from '@prdm/collab';
import { restoreDocumentVersion } from '../../src/collab/restore.js';
import { captureDocumentVersion } from '../../src/collab/versions.js';
import { seedUser } from '../helpers/seed-auth.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceSynced, onceUnsyncedChangesSettled, startCollabApp } from './ws-test-helpers.js';

type BuiltApp = Awaited<ReturnType<typeof startCollabApp>>['app'];
type Provider = ReturnType<typeof makeCollabProvider>;

/** Mirrors `documents-restore.test.ts`'s own `seedLiveEdit`: appends one more `doc_updates` row on top of
 * `shared`'s running state, without needing a live websocket connection. */
async function seedEdit(pg: PgTestDb, shared: Y.Doc, params: { orgId: string; documentId: string; seq: number; actorId: string }, mutate: (doc: Y.Doc) => void): Promise<void> {
  const clientDoc = new Y.Doc({ gc: false });
  Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(shared));
  const before = Y.encodeStateVector(clientDoc);
  mutate(clientDoc);
  const update = Buffer.from(Y.encodeStateAsUpdate(clientDoc, before));
  Y.applyUpdate(shared, update);
  const { structRanges, deleteRanges } = decodeUpdateRanges(update);
  await pg.ownerPool.query(
    `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, user_id, struct_ranges, delete_ranges, update)
     VALUES ($1, $2, $3, 'user', $4, $5, $6, $7)`,
    [params.orgId, params.documentId, params.seq, params.actorId, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
  );
}

interface TransactObservation {
  attributionRowCommittedBeforeApply?: boolean;
  bindingCommittedBeforeApply?: boolean;
}

/** A minimal fake standing in for `Hocuspocus`, just enough of `openDirectConnection`'s shape for
 * `restoreDocumentVersion` to use. Its `transact` is the one moment `restore.js` ever mutates/broadcasts
 * the live document, so checking Postgres for the durable row *at that exact instant* (never on a timer)
 * tells us, deterministically, whether the write already happened.
 *
 * `ownerPoolForAssertions` deliberately bypasses RLS (same reasoning as every other raw verification
 * query in this suite, e.g. `documents-restore.test.ts`'s own checks): `doc_updates`/`doc_client_bindings`
 * rows are only visible through the `app.current_org_id` GUC `withTenantTx` sets for the *duration of its
 * own transaction* — a plain query issued from outside that transaction (as this check necessarily is)
 * would see zero rows regardless of commit state if it went through the RLS-scoped `appPool` instead. */
function createObservingFakeHocuspocus(ownerPoolForAssertions: Pool, documentId: string, restoringUserId: string, observation: TransactObservation): Hocuspocus {
  return {
    async openDirectConnection() {
      const doc = createDocumentYDoc();
      return {
        document: doc,
        async transact(transaction: (doc: Y.Doc) => void) {
          const [rows, bindingRows] = await Promise.all([
            ownerPoolForAssertions.query('SELECT 1 FROM doc_updates WHERE document_id = $1 AND user_id = $2', [documentId, restoringUserId]),
            ownerPoolForAssertions.query('SELECT 1 FROM doc_client_bindings WHERE document_id = $1 AND user_id = $2', [documentId, restoringUserId]),
          ]);
          observation.attributionRowCommittedBeforeApply = rows.rowCount! > 0;
          observation.bindingCommittedBeforeApply = bindingRows.rowCount! > 0;
          doc.transact(() => transaction(doc), { source: 'local' });
        },
        async disconnect() {},
      };
    },
  } as unknown as Hocuspocus;
}

describe('version restore durable-write-before-broadcast (SDD-008, WO-218)', () => {
  let pg: PgTestDb;

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterAll(async () => {
    await pg.close();
  });

  test('the doc_updates/doc_client_bindings row is already committed by the moment the live Y.Doc is mutated', async () => {
    const authorA = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const restorerB = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: authorA.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: restorerB.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const shared = new Y.Doc({ gc: false });
    await seedEdit(pg, shared, { orgId: org.id, documentId, seq: 1, actorId: authorA.id }, (doc) => doc.getText('body').insert(0, 'Original content'));

    const version = await captureDocumentVersion(pg.appPool, org.id, { documentId, reason: 'manual', label: 'v1', createdBy: authorA.id });
    expect(version).not.toBeNull();

    await seedEdit(pg, shared, { orgId: org.id, documentId, seq: 2, actorId: authorA.id }, (doc) => {
      doc.getText('body').delete(0, doc.getText('body').length);
      doc.getText('body').insert(0, 'Overwritten after v1');
    });

    const observation: TransactObservation = {};
    const fakeHocuspocus = createObservingFakeHocuspocus(pg.ownerPool, documentId, restorerB.id, observation);

    await restoreDocumentVersion(pg.appPool, fakeHocuspocus, {
      orgId: org.id,
      projectId: project.id,
      documentId,
      versionNo: version!.versionNo,
      restoringUserId: restorerB.id,
    });

    expect(observation.attributionRowCommittedBeforeApply).toBe(true);
    expect(observation.bindingCommittedBeforeApply).toBe(true);
  });
});

describe('a concurrent live edit racing a restore of the same document (SDD-008, WO-218)', () => {
  let pg: PgTestDb;
  let app: BuiltApp;
  let url: string;
  const AUTH_HOST = { host: new URL(ISOLATION_TEST_ENV.publicUrl).host };
  const providers: Provider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    const started = await startCollabApp({ pool: pg.appPool });
    app = started.app;
    url = started.url;
  });

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) provider.destroy();
  });

  async function setupOrgAndProject() {
    const editorA = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const restorerB = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const org = await createOrganizationFixture(pg);
    for (const u of [editorA, restorerB]) await createMemberFixture(pg, { organizationId: org.id, userId: u.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editorA.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, restorerB.id, org.id]);
    return { editorA, restorerB, org, project };
  }

  async function createDocument(org: { slug: string }, project: { slug: string }, cookie: string): Promise<{ id: string; docId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ISOLATION_ORIGIN, cookie),
      payload: { kind: 'PRD', title: 'Restore race doc' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    return { id: body.document.id, docId: body.document.docId };
  }

  test('no misattribution, no crash, no update silently dropped', async () => {
    const { editorA, restorerB, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editorA.email);
    const restorerCookie = await signIn(app, restorerB.email);
    const document = await createDocument(org, project, editorCookie);
    const documentName = `${project.id}:${document.id}`;

    const editorProvider = makeCollabProvider(url, documentName, { cookie: editorCookie, origin: ISOLATION_ORIGIN });
    providers.push(editorProvider);
    await onceSynced(editorProvider);

    editorProvider.document.getText('body').insert(0, 'Original content');
    await onceUnsyncedChangesSettled(editorProvider);
    const editorClientId = String(editorProvider.document.clientID);

    const saved = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: await mutationHeaders(app, AUTH_HOST, ISOLATION_ORIGIN, editorCookie),
      payload: { label: 'v1' },
    });
    expect(saved.statusCode).toBe(200);
    const targetVersionNo: number = saved.json().version.versionNo;

    editorProvider.document.getText('body').insert(0, 'Diverged before race. ');
    await onceUnsyncedChangesSettled(editorProvider);

    let editorDisconnected = false;
    editorProvider.on('close', () => {
      editorDisconnected = true;
    });

    const marker = `race-${randomUUID()}`;
    const restoreCall = app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/${targetVersionNo}/restore`,
      headers: await mutationHeaders(app, AUTH_HOST, ISOLATION_ORIGIN, restorerCookie),
    });
    const concurrentEdit = (async () => {
      editorProvider.document.getText('body').insert(0, marker);
      await onceUnsyncedChangesSettled(editorProvider);
    })();

    const [restoreResponse] = await Promise.all([restoreCall, concurrentEdit]);
    expect(restoreResponse.statusCode).toBe(200);
    expect(editorDisconnected).toBe(false);

    const rows = await pg.ownerPool.query<{ user_id: string | null; struct_ranges: { client: number }[] }>(
      `SELECT user_id, struct_ranges FROM doc_updates WHERE document_id = $1 ORDER BY seq`,
      [document.id],
    );
    // Neither actor's contribution was silently dropped.
    expect(rows.rows.some((r) => r.user_id === editorA.id)).toBe(true);
    expect(rows.rows.some((r) => r.user_id === restorerB.id)).toBe(true);

    const bindings = await pg.ownerPool.query<{ client_id: string; user_id: string }>(`SELECT client_id, user_id FROM doc_client_bindings WHERE document_id = $1`, [document.id]);
    const editorBinding = bindings.rows.find((b) => b.client_id === editorClientId);
    expect(editorBinding?.user_id).toBe(editorA.id);
    // No cross-attribution: the restorer's fresh client id is never bound to the editor, and the editor's
    // real client id is never bound to the restorer.
    expect(bindings.rows.every((b) => b.client_id !== editorClientId || b.user_id === editorA.id)).toBe(true);
    const restorerBindings = bindings.rows.filter((b) => b.user_id === restorerB.id);
    expect(restorerBindings.length).toBeGreaterThan(0);
    for (const binding of restorerBindings) expect(binding.client_id).not.toBe(editorClientId);
  });
});
