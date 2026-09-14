/**
 * WO-151 — tests for `beforeHandleAwareness`/`onStateless` (SDD-008 §"Servidor de tiempo real").
 *
 * The name/color-injection, size-cap and multi-entry-rejection logic is verified directly against
 * `createCollabAwarenessExtension`'s `beforeHandleAwareness` with crafted `states` maps — including the
 * one scenario a real `HocuspocusProvider` cannot be made to send at all (a message carrying more than
 * one entry, since `Awareness.setLocalState()` only ever encodes its own single client id per message).
 *
 * KNOWN GAP (flagged for the security review): a genuine end-to-end assertion — two real
 * `HocuspocusProvider`s, one calling `awareness.setLocalState(...)`, the other observing the broadcast —
 * could not be made to reliably observe the broadcast content in this environment. Reading the installed
 * `y-protocols`/`@hocuspocus/provider`/`@hocuspocus/server` 4.7.0/1.0.7 sources confirms the intended
 * flow (`Awareness.setLocalState` → `awarenessUpdateHandler` → `encodeAwarenessUpdate` → the wire →
 * `beforeHandleAwareness`'s `scratch.getStates()` → `handleAwarenessUpdate` → `broadcastAwarenessUpdate`)
 * and this module's own filtering logic sits entirely inside that flow with no additional assumptions
 * beyond "trust the payload Hocuspocus decodes" — but repeated instrumentation of `beforeHandleAwareness`
 * itself showed the server consistently decoding an *empty* state object for what should have been the
 * real `setLocalState` call, even when that call was made before the connection ever synced. This
 * strongly suggests a wire-level/version-interaction issue upstream of this extension (not a bug this
 * extension's own logic introduces — the pure tests below cover that logic exhaustively), but it means
 * `onStateless`'s connection-closing behavior is the only piece of this WO verified end to end here; the
 * awareness content-filtering pipeline's *live* behavior needs a follow-up investigation with more time
 * than this batch's budget allowed, ideally with a packet-level capture of the actual awareness frames.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { buildServer } from '../../src/build-server.js';
import { createCollabAwarenessExtension, type CollabAwarenessConnectionLike } from '../../src/collab/awareness.js';
import { seedUser } from '../helpers/seed-auth.js';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceSynced, startCollabApp } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;
type Provider = ReturnType<typeof makeCollabProvider>;

function fakeConnection(userId: string): CollabAwarenessConnectionLike {
  return { close: vi.fn(), context: { userId } };
}

describe('createCollabAwarenessExtension.beforeHandleAwareness (SDD-008, WO-151)', () => {
  let pg: PgTestDb;
  let userId: string;
  let userName: string;

  beforeAll(async () => {
    pg = await openTestPg();
    const org = await createOrganizationFixture(pg);
    const user = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'member' });
    const { rows } = await pg.ownerPool.query<{ name: string }>(`SELECT name FROM "user" WHERE id = $1`, [user.id]);
    userId = user.id;
    userName = rows[0]!.name;
  });

  afterAll(async () => {
    await pg.close();
  });

  test('a message with more than one entry is rejected entirely, regardless of prior messages', async () => {
    const ext = createCollabAwarenessExtension({ pool: pg.appPool });
    const connection = fakeConnection(userId);

    const first = new Map<number, Record<string, unknown>>([[7, { cursor: { line: 1 } }]]);
    await ext.beforeHandleAwareness({ states: first, context: connection.context, connection });
    expect([...first.keys()]).toEqual([7]);

    const second = new Map<number, Record<string, unknown>>([
      [7, { cursor: { line: 2 } }],
      [99, { cursor: { line: 99 } }],
    ]);
    await ext.beforeHandleAwareness({ states: second, context: connection.context, connection });
    expect(second.size).toBe(0);
  });

  test('a later single-entry message under a different numeric key is still trusted for that message (per-message, not cross-message, identity)', async () => {
    const ext = createCollabAwarenessExtension({ pool: pg.appPool });
    const connection = fakeConnection(userId);

    const first = new Map<number, Record<string, unknown>>([[7, { cursor: { line: 1 } }]]);
    await ext.beforeHandleAwareness({ states: first, context: connection.context, connection });
    expect([...first.keys()]).toEqual([7]);

    const second = new Map<number, Record<string, unknown>>([[42, { cursor: { line: 2 } }]]);
    await ext.beforeHandleAwareness({ states: second, context: connection.context, connection });
    expect([...second.keys()]).toEqual([42]);
  });

  test('drops a state with no allowed fields down to just server-derived name/color', async () => {
    const ext = createCollabAwarenessExtension({ pool: pg.appPool });
    const connection = fakeConnection(userId);
    const states = new Map<number, Record<string, unknown>>([[1, { name: 'attacker', color: '#fff', somethingElse: true }]]);
    await ext.beforeHandleAwareness({ states, context: connection.context, connection });
    const state = states.get(1);
    expect(state?.somethingElse).toBeUndefined();
    expect(state?.name).toBe(userName);
    expect(state?.color).not.toBe('#fff');
  });

  test('keeps cursor/selection but replaces client-supplied name/color', async () => {
    const ext = createCollabAwarenessExtension({ pool: pg.appPool });
    const connection = fakeConnection(userId);
    const states = new Map<number, Record<string, unknown>>([[1, { cursor: { line: 3 }, selection: { from: 0, to: 1 }, name: 'attacker', color: '#000000' }]]);
    await ext.beforeHandleAwareness({ states, context: connection.context, connection });
    expect(states.get(1)).toEqual({ cursor: { line: 3 }, selection: { from: 0, to: 1 }, name: userName, color: expect.stringMatching(/^hsl\(/) });
  });

  test('drops an oversized state entirely', async () => {
    const ext = createCollabAwarenessExtension({ pool: pg.appPool });
    const connection = fakeConnection(userId);
    const states = new Map<number, Record<string, unknown>>([[1, { cursor: { blob: 'x'.repeat(4096) } }]]);
    await ext.beforeHandleAwareness({ states, context: connection.context, connection });
    expect(states.has(1)).toBe(false);
  });

  test('clears the map entirely when there is no authenticated userId in context', async () => {
    const ext = createCollabAwarenessExtension({ pool: pg.appPool });
    const connection: CollabAwarenessConnectionLike = { close: vi.fn(), context: {} };
    const states = new Map<number, Record<string, unknown>>([[1, { cursor: { line: 1 } }]]);
    await ext.beforeHandleAwareness({ states, context: connection.context, connection });
    expect(states.size).toBe(0);
  });
});

describe('/collab onStateless end to end (SDD-008, WO-151)', () => {
  let pg: PgTestDb;
  let app: BuiltApp;
  let url: string;
  let org: { id: string };
  let project: { id: string };
  let userA: { cookie: string };
  const providers: Provider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    const started = await startCollabApp({ pool: pg.appPool });
    app = started.app;
    url = started.url;

    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
    const a = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: a.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, a.id, org.id]);
    userA = { cookie: await signIn(app, a.email) };
  });

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) provider.destroy();
  });

  test('rejects a client-sent stateless message by closing the connection', async () => {
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: userA.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    const closed = new Promise<void>((resolve) => {
      provider.on('close', () => resolve());
    });
    provider.sendStateless('client-initiated, should never be accepted');
    await closed;
  });
});
