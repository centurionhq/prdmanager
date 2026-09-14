/**
 * WO-150 — integration tests for the `beforeSync` anti-spoofing check (SDD-008 §"Autoría por línea no
 * falsificable"). A real Fastify server, real `HocuspocusProvider` clients over real `ws`, and a real
 * Postgres test database.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { seedUser } from '../helpers/seed-auth.js';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { headeredWebSocketPolyfill, makeCollabProvider, onceSynced, onceUnsyncedChangesSettled, startCollabApp } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;
type Provider = ReturnType<typeof makeCollabProvider>;

function onceClosed(provider: Provider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('close', handler);
      resolve();
    };
    provider.on('close', handler);
  });
}

describe('/collab beforeSync anti-spoofing (SDD-008, WO-150)', () => {
  let pg: PgTestDb;
  let app: BuiltApp;
  let url: string;
  let org: { id: string };
  let project: { id: string };
  let userA: { id: string; cookie: string };
  let attacker: { id: string; cookie: string };
  const providers: Provider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    const started = await startCollabApp({ pool: pg.appPool });
    app = started.app;
    url = started.url;

    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });

    const a = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const b = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: a.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: b.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, a.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, b.id, org.id]);
    userA = { id: a.id, cookie: await signIn(app, a.email) };
    attacker = { id: b.id, cookie: await signIn(app, b.email) };
  });

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) provider.destroy();
  });

  test('rejects and closes the connection of a client extending another user\'s already-bound client id with new content', async () => {
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const providerA = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: userA.cookie, origin: ISOLATION_ORIGIN });
    providers.push(providerA);
    await onceSynced(providerA);
    providerA.document.getText('body').insert(0, 'legit content');
    await onceUnsyncedChangesSettled(providerA);
    const legitClientId = providerA.document.clientID;

    // Forge a Y.Doc that already has A's full history, then continues writing new content *as if it
    // were client A* — this is exactly the "new content under someone else's bound client id" case
    // ./anti-spoofing.js must reject (an honest resend of only-already-known content, by contrast, must
    // never be rejected — covered by the pure unit tests in packages/collab).
    const forgedDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(forgedDoc, Y.encodeStateAsUpdate(providerA.document));
    // `clientID` is a plain, intentionally-mutable property on Y.Doc; forging it is exactly the
    // attack this test simulates.
    forgedDoc.clientID = legitClientId;
    forgedDoc.getText('body').insert(forgedDoc.getText('body').length, ' FORGED');

    const attackerConfig: object = {
      url,
      name: `${project.id}:${doc}`,
      document: forgedDoc,
      WebSocketPolyfill: headeredWebSocketPolyfill({ cookie: attacker.cookie, origin: ISOLATION_ORIGIN }),
    };
    const attackerProvider = new HocuspocusProvider(attackerConfig as ConstructorParameters<typeof HocuspocusProvider>[0]);
    providers.push(attackerProvider);

    await onceClosed(attackerProvider);

    // The forged content must never have reached the document: check via a fresh, uninvolved connection.
    const observer = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: userA.cookie, origin: ISOLATION_ORIGIN });
    providers.push(observer);
    await onceSynced(observer);
    expect(observer.document.getText('body').toString()).toBe('legit content');
    expect(observer.document.getText('body').toString()).not.toContain('FORGED');

    const audit = await pg.ownerPool.query<{ action: string; actor_id: string; target: string }>(
      `SELECT action, actor_id, target FROM audit_log WHERE action = 'collab.update_rejected_spoofing' AND target = $1`,
      [doc],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows[0]?.actor_id).toBe(attacker.id);
  });

  test('an honest client resending its full history after a server restart is never disconnected', async () => {
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const before = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: userA.cookie, origin: ISOLATION_ORIGIN });
    providers.push(before);
    await onceSynced(before);
    before.document.getText('body').insert(0, 'survives a restart');
    await onceUnsyncedChangesSettled(before);
    const clonedState = Y.encodeStateAsUpdate(before.document);
    const clientId = before.document.clientID;
    before.destroy();
    providers.splice(providers.indexOf(before), 1);

    // Simulate a server process restart: a brand-new Hocuspocus/Fastify instance, same Postgres.
    await app.close();
    const restarted = await startCollabApp({ pool: pg.appPool });
    app = restarted.app;
    url = restarted.url;

    // The reconnecting client keeps its own Y.Doc (and therefore its client id) across the reconnect —
    // realistic for a provider auto-reconnecting within the same browser tab — and resends its full
    // accumulated state as part of the normal sync handshake.
    const reconnectedDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(reconnectedDoc, clonedState);
    // Restoring the exact same client id a real reconnecting provider would already have (see the
    // forged-client test above for why this assignment is legitimate to make directly).
    reconnectedDoc.clientID = clientId;

    const reconnectedConfig: object = {
      url,
      name: `${project.id}:${doc}`,
      document: reconnectedDoc,
      WebSocketPolyfill: headeredWebSocketPolyfill({ cookie: userA.cookie, origin: ISOLATION_ORIGIN }),
    };
    const reconnected = new HocuspocusProvider(reconnectedConfig as ConstructorParameters<typeof HocuspocusProvider>[0]);
    providers.push(reconnected);

    await onceSynced(reconnected);
    expect(reconnected.document.getText('body').toString()).toBe('survives a restart');
  });
});
