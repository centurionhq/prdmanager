/**
 * WO-147 — `documentName` cross-org and cross-project cases for the isolation suite (SDD-006
 * §Aislamiento por capas point 4, SDD-008 §"Servidor de tiempo real"). `./collab-route.ts` registers
 * `GET /collab` as `skip` in the generic HTTP-inject-based prober (a WebSocket upgrade can't be driven
 * that way) — this file is the dedicated real-client replacement it points to, reusing the exact same
 * `buildIsolationFixtures` fixtures (org A/B, project A1/A2, the canary string, the pre-signed session
 * cookies) the rest of the suite is built on, run through a real `HocuspocusProvider` instead of
 * `app.inject()`.
 *
 * Both cases must fail the Hocuspocus handshake (`onAuthenticate` throws, surfaced to the client as
 * `authenticationFailed`) with no canary content ever reaching the client — checked in the rejection
 * reason itself and in the client's own `Y.Doc`, which must stay completely empty.
 */
import { openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { insertCollabDocumentFixture } from '../collab/document-fixture.js';
import { makeCollabProvider, onceAuthenticationFailed } from '../collab/ws-test-helpers.js';
import { buildIsolationFixtures, ISOLATION_ORIGIN, ISOLATION_TEST_ENV } from './fixtures.js';
import type { BuiltApp, IsolationFixtures } from './types.js';

type Provider = ReturnType<typeof makeCollabProvider>;

describe('documentName cross-tenant rejection (SDD-006/SDD-008, WO-147)', () => {
  let pg: PgTestDb;
  let app: BuiltApp;
  let fixtures: IsolationFixtures;
  let url: string;
  let documentIdInProjectA1: string;
  const providers: Provider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    app = buildServer({ env: ISOLATION_TEST_ENV, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    await app.ready();
    fixtures = await buildIsolationFixtures(app, pg);
    documentIdInProjectA1 = await insertCollabDocumentFixture(pg, { orgId: fixtures.orgA.id, projectId: fixtures.projectA1.id });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    url = `ws://127.0.0.1:${address.port}/collab`;
  });

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) provider.destroy();
  });

  test('an org-B session against org-A project A1\'s documentName fails the handshake with no canary leak', async () => {
    const documentName = `${fixtures.projectA1.id}:${documentIdInProjectA1}`;
    const provider = makeCollabProvider(url, documentName, { cookie: fixtures.orgBOwnerSessionCookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);

    const failure = await onceAuthenticationFailed(provider);

    expect(failure.reason).toBe('permission-denied');
    expect(failure.reason).not.toContain(fixtures.canary);
    expect(provider.document.getText('body').toString()).toBe('');
    expect(provider.document.getText('body').toString()).not.toContain(fixtures.canary);
    expect(JSON.stringify(provider.document.getMap('fm').toJSON())).not.toContain(fixtures.canary);
  });

  test('a same-org user with no project_members row in project A1 fails the handshake with no canary leak', async () => {
    const documentName = `${fixtures.projectA1.id}:${documentIdInProjectA1}`;
    const provider = makeCollabProvider(url, documentName, { cookie: fixtures.orgAOutsiderSessionCookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);

    const failure = await onceAuthenticationFailed(provider);

    expect(failure.reason).toBe('permission-denied');
    expect(failure.reason).not.toContain(fixtures.canary);
    expect(provider.document.getText('body').toString()).toBe('');
    expect(provider.document.getText('body').toString()).not.toContain(fixtures.canary);
    expect(JSON.stringify(provider.document.getMap('fm').toJSON())).not.toContain(fixtures.canary);
  });
});
