/**
 * WO-152 — integration tests for `/collab`'s numeric limits (SDD-008 §"Servidor de tiempo real"). A
 * real Fastify server and real `HocuspocusProvider` clients over real `ws`, hammering the server rather
 * than a hand-rolled client — exactly what the WO asks for. The per-second update-rate limits use an
 * injected, test-controlled clock (`../../src/collab/rate-window.js`'s own reasoning) so the test never
 * has to send real traffic across a full wall-clock second.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer, type BuildServerDeps } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { seedUser } from '../helpers/seed-auth.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceSynced, onceUnsyncedChangesSettled } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;
type Provider = ReturnType<typeof makeCollabProvider>;

interface StartLimitedAppDeps extends Partial<Omit<BuildServerDeps, 'env'>> {
  env?: Partial<BuildServerDeps['env']>;
}

async function startLimitedApp(deps: StartLimitedAppDeps): Promise<{ app: BuiltApp; url: string }> {
  const app = buildServer({
    logger: false,
    mailer: new FakeMailer(),
    collabPersistDebounce: { debounce: 0, maxDebounce: 0 },
    ...deps,
    env: { ...ISOLATION_TEST_ENV, ...deps.env },
  });
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  return { app, url: `ws://127.0.0.1:${address.port}/collab` };
}

function onceClosed(provider: Provider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('close', handler);
      resolve();
    };
    provider.on('close', handler);
  });
}

describe('/collab numeric limits (SDD-008, WO-152)', () => {
  let pg: PgTestDb;
  let org: { id: string };
  let project: { id: string };
  let editor: { id: string; cookie: string };
  const providers: Provider[] = [];
  const apps: BuiltApp[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
    const user = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, user.id, org.id]);
    // Signed in once against a throwaway bootstrap app (see revocation.test.ts's own note on
    // better-auth's 5-per-15-minutes sign-in rate limit) and reused across every test below.
    const bootstrap = await startLimitedApp({ pool: pg.appPool });
    editor = { id: user.id, cookie: await signIn(bootstrap.app, user.email) };
    await bootstrap.app.close();
  });

  afterAll(async () => {
    await pg.close();
  });

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    for (const app of apps.splice(0)) await app.close();
  });

  test('closes a connection that would exceed the per-document connection limit', async () => {
    const started = await startLimitedApp({ pool: pg.appPool, env: { collabLimits: { ...ISOLATION_TEST_ENV.collabLimits, maxConnectionsPerDocument: 2 } } });
    apps.push(started.app);
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const first = makeCollabProvider(started.url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    const second = makeCollabProvider(started.url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(first, second);
    await Promise.all([onceSynced(first), onceSynced(second)]);

    const third = makeCollabProvider(started.url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(third);
    await onceClosed(third);

    const audit = await pg.ownerPool.query(`SELECT 1 FROM audit_log WHERE action = 'collab.limit_connections_per_document' AND target = $1`, [doc]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  test('closes a connection that would exceed the per-user connection limit across different documents', async () => {
    const started = await startLimitedApp({ pool: pg.appPool, env: { collabLimits: { ...ISOLATION_TEST_ENV.collabLimits, maxConnectionsPerUser: 2 } } });
    apps.push(started.app);
    const docA = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const docB = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const docC = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const first = makeCollabProvider(started.url, `${project.id}:${docA}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    const second = makeCollabProvider(started.url, `${project.id}:${docB}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(first, second);
    await Promise.all([onceSynced(first), onceSynced(second)]);

    const third = makeCollabProvider(started.url, `${project.id}:${docC}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(third);
    await onceClosed(third);

    const audit = await pg.ownerPool.query(`SELECT 1 FROM audit_log WHERE action = 'collab.limit_connections_per_user' AND actor_id = $1`, [editor.id]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  test('closes a connection that exceeds the per-user update rate limit', async () => {
    const now = 1_000_000;
    const started = await startLimitedApp({
      pool: pg.appPool,
      clock: () => new Date(now),
      env: { collabLimits: { ...ISOLATION_TEST_ENV.collabLimits, maxUpdatesPerSecPerUser: 5 } },
    });
    apps.push(started.app);
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const provider = makeCollabProvider(started.url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    const closed = onceClosed(provider);
    // All within the same frozen 1-second window (the clock never advances): the 6th update (over the
    // limit of 5) must close the connection.
    for (let i = 0; i < 8; i += 1) {
      provider.document.transact(() => provider.document.getText('body').insert(0, 'x'));
    }
    await closed;
  });

  test('rejects further growth once the rendered body size limit is reached, keeping the document read-only', async () => {
    const started = await startLimitedApp({ pool: pg.appPool, env: { collabLimits: { ...ISOLATION_TEST_ENV.collabLimits, maxRenderedBytes: 16 } } });
    apps.push(started.app);
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    const writer = makeCollabProvider(started.url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(writer);
    await onceSynced(writer);

    // First edit fits under the 16-byte cap and must be accepted (the check runs against the size
    // *before* applying, so the edit that actually pushes the document over the limit — the second one
    // below — is still allowed through, per SDD-008's "un documento que *alcanza* el tope"; only a
    // *third* edit, checked against the now-oversized body, is rejected).
    writer.document.getText('body').insert(0, 'short');
    await onceUnsyncedChangesSettled(writer);

    writer.document.getText('body').insert(0, 'this pushes it well past the limit');
    await onceUnsyncedChangesSettled(writer);
    const grownContent = writer.document.getText('body').toString();
    expect(Buffer.byteLength(grownContent, 'utf8')).toBeGreaterThan(16);

    const closed = onceClosed(writer);
    writer.document.getText('body').insert(0, 'one more edit past the frozen cap');
    await closed;

    const observer = makeCollabProvider(started.url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(observer);
    await onceSynced(observer);
    expect(observer.document.getText('body').toString()).toBe(grownContent);
  });
});
