/**
 * WO-166 — multi-client convergence: concurrent edits from two real `HocuspocusProvider`s converge to
 * the same content, a reconnecting client (across a socket-level disconnect, and across a full server
 * restart) never gets falsely rejected by the anti-spoofing check or loses data, and blame (WO-153)
 * stays correct once everything settles. Reuses the exact real `/collab` route (full auth + anti-
 * spoofing + attribution pipeline, WO-144-152) via `startCollabApp`/`makeCollabProvider`
 * (`./ws-test-helpers.js`) — never a bespoke minimal harness. Every wait is on a real provider/Y.Doc
 * event, never a timer.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { buildRangeIndex, computeBlame, createDocumentYDoc } from '@prdm/collab';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { seedUser } from '../helpers/seed-auth.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { headeredWebSocketPolyfill, makeCollabProvider, onceSynced, onceUnsyncedChangesSettled, startCollabApp } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;

/** Same as `makeCollabProvider`, but reuses an existing `Y.Doc` (and therefore the same client id) —
 * simulating "the same honest client reconnects", never a fresh identity. */
function reconnectCollabProvider(url: string, documentName: string, headers: Record<string, string>, document: Y.Doc): HocuspocusProvider {
  const config: object = { url, name: documentName, document, WebSocketPolyfill: headeredWebSocketPolyfill(headers) };
  return new HocuspocusProvider(config as ConstructorParameters<typeof HocuspocusProvider>[0]);
}

function onceDisconnected(provider: HocuspocusProvider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('disconnect', handler);
      resolve();
    };
    provider.on('disconnect', handler);
  });
}

function onceClosed(provider: HocuspocusProvider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('close', handler);
      resolve();
    };
    provider.on('close', handler);
  });
}

async function docUpdateRowsFor(pg: PgTestDb, documentId: string) {
  const { rows } = await pg.ownerPool.query(
    `SELECT seq, actor_kind, user_id, on_behalf_of, agent_id, update, struct_ranges, delete_ranges, received_at
     FROM doc_updates WHERE document_id = $1 ORDER BY seq`,
    [documentId],
  );
  return rows as {
    seq: number;
    actor_kind: 'user' | 'agent' | 'system' | null;
    user_id: string | null;
    on_behalf_of: string | null;
    agent_id: string | null;
    update: Buffer;
    struct_ranges: unknown;
    delete_ranges: unknown;
    received_at: Date;
  }[];
}

describe('multi-client convergence (SDD-008, WO-166)', () => {
  let pg: PgTestDb;
  let org: { id: string; slug: string };
  let project: { id: string; slug: string };
  let editorA: { id: string; cookie: string };
  let editorB: { id: string; cookie: string };
  const apps: BuiltApp[] = [];
  const providers: HocuspocusProvider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });

    const built = await startCollabApp({ pool: pg.appPool });
    const userA = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const userB = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: userA.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: userB.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, userA.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, userB.id, org.id]);
    editorA = { id: userA.id, cookie: await signIn(built.app, userA.email) };
    editorB = { id: userB.id, cookie: await signIn(built.app, userB.email) };
    await built.app.close();
  });

  afterAll(async () => {
    await pg.close();
  });

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    for (const app of apps.splice(0)) await app.close();
  });

  test('concurrent edits from two providers converge to the same content', async () => {
    const { app, url } = await startCollabApp({ pool: pg.appPool });
    apps.push(app);
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const a = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editorA.cookie, origin: ISOLATION_ORIGIN });
    const b = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editorB.cookie, origin: ISOLATION_ORIGIN });
    providers.push(a, b);
    await Promise.all([onceSynced(a), onceSynced(b)]);

    a.document.getText('body').insert(0, 'from A\n');
    b.document.getText('body').insert(0, 'from B\n');
    await Promise.all([onceUnsyncedChangesSettled(a), onceUnsyncedChangesSettled(b)]);

    await new Promise<void>((resolve) => {
      const check = () => {
        if (a.document.getText('body').toString() !== b.document.getText('body').toString()) return;
        a.document.off('update', check);
        b.document.off('update', check);
        resolve();
      };
      a.document.on('update', check);
      b.document.on('update', check);
      check();
    });

    const finalText = a.document.getText('body').toString();
    expect(finalText).toBe(b.document.getText('body').toString());
    expect(finalText).toContain('from A');
    expect(finalText).toContain('from B');
  });

  test('a provider that disconnects mid-session and edits while offline catches back up with no data loss and no false rejection', async () => {
    const { app, url } = await startCollabApp({ pool: pg.appPool });
    apps.push(app);
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const solo = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editorA.cookie, origin: ISOLATION_ORIGIN });
    providers.push(solo);
    await onceSynced(solo);
    solo.document.getText('body').insert(0, 'online content\n');
    await onceUnsyncedChangesSettled(solo);

    // Goes offline (socket-level disconnect — the same provider/Y.Doc, no destroy).
    solo.disconnect();
    await onceDisconnected(solo);

    // Edits while offline: a real Y.Doc mutation queues locally, nothing sent yet.
    solo.document.getText('body').insert(solo.document.getText('body').length, 'offline content\n');
    expect(solo.hasUnsyncedChanges).toBe(true);

    // Reconnects — must not be disconnected/rejected, and the offline edit must reach the server.
    solo.connect();
    await onceSynced(solo);
    await onceUnsyncedChangesSettled(solo);

    const observer = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editorB.cookie, origin: ISOLATION_ORIGIN });
    providers.push(observer);
    await onceSynced(observer);

    const content = observer.document.getText('body').toString();
    expect(content).toContain('online content');
    expect(content).toContain('offline content');
  });

  test('reconnecting across a full server restart (same client id) is never rejected and loses no data', async () => {
    const first = await startCollabApp({ pool: pg.appPool });
    apps.push(first.app);
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const before = makeCollabProvider(first.url, `${project.id}:${doc}`, { cookie: editorA.cookie, origin: ISOLATION_ORIGIN });
    await onceSynced(before);
    before.document.getText('body').insert(0, 'before restart\n');
    await onceUnsyncedChangesSettled(before);
    const sharedDoc = before.document;
    before.destroy(); // drops the socket, keeps `sharedDoc` (same client id) alive

    // Simulate a server restart: the old Hocuspocus instance (and its in-memory document, if still
    // loaded) is gone; a brand-new one reloads the document fresh from Postgres on next connect.
    await first.app.close();
    const second = await startCollabApp({ pool: pg.appPool });
    apps.push(second.app);

    const after = reconnectCollabProvider(second.url, `${project.id}:${doc}`, { cookie: editorA.cookie, origin: ISOLATION_ORIGIN }, sharedDoc);
    providers.push(after);

    const closed = onceClosed(after);
    await onceSynced(after);
    // A real rejection would close the socket outright — confirm that never raced ahead of `synced`.
    await Promise.race([closed.then(() => Promise.reject(new Error('connection was closed — anti-spoofing falsely rejected an honest reconnect'))), Promise.resolve()]);

    expect(after.document.getText('body').toString()).toBe('before restart\n');

    after.document.getText('body').insert(after.document.getText('body').length, 'after restart\n');
    await onceUnsyncedChangesSettled(after);

    const observer = makeCollabProvider(second.url, `${project.id}:${doc}`, { cookie: editorB.cookie, origin: ISOLATION_ORIGIN });
    providers.push(observer);
    await onceSynced(observer);
    const finalText = observer.document.getText('body').toString();
    expect(finalText).toBe('before restart\nafter restart\n');

    // Blame (WO-153) stays correct: every line still attributes to editorA, the only person who ever
    // touched this document, across the restart and reconnect.
    const rows = await docUpdateRowsFor(pg, doc);
    expect(rows.length).toBeGreaterThan(0);
    const index = buildRangeIndex(
      rows.map((r) => ({
        structRanges: r.struct_ranges as never,
        deleteRanges: r.delete_ranges as never,
        actorKind: r.actor_kind ?? 'system',
        userId: r.user_id,
        onBehalfOf: r.on_behalf_of,
        agentId: r.agent_id,
        receivedAt: r.received_at,
      })),
    );
    const replay = createDocumentYDoc();
    for (const row of rows) Y.applyUpdate(replay, row.update);
    const blame = computeBlame(replay, index);
    expect(blame.lines.length).toBeGreaterThan(0);
    for (const line of blame.lines) {
      expect(line.attribution?.userId).toBe(editorA.id);
    }
  });
});
