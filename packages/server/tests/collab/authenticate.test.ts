/**
 * WO-146 — integration tests for `/collab`'s upgrade checks (Origin, session) and `onAuthenticate`'s
 * per-document authorization (SDD-008 §"Servidor de tiempo real"): a real Fastify server listening on an
 * OS-assigned port, real `ws`/`HocuspocusProvider` clients, and a real Postgres test database.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createOrganizationFixture, createProjectFixture, createMemberFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer, type BuildServerDeps } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { seedUser } from '../helpers/seed-auth.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceAuthenticationFailed, onceSynced } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;

async function startApp(deps: Partial<BuildServerDeps> = {}): Promise<{ app: BuiltApp; url: string }> {
  const app = buildServer({ env: ISOLATION_TEST_ENV, mailer: new FakeMailer(), logger: false, ...deps });
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  return { app, url: `ws://127.0.0.1:${address.port}/collab` };
}

const makeProvider = makeCollabProvider;
const insertDocument = insertCollabDocumentFixture;

describe('/collab upgrade + onAuthenticate (SDD-008, WO-146)', () => {
  let pg: PgTestDb;
  let org: { id: string };
  let otherProject: { id: string };
  let project: { id: string };
  let ownerCookie: string;
  let editorCookie: string;
  let viewerCookie: string;
  let outsiderCookie: string;
  let strangerCookie: string;
  let docCollab: string;
  let docGenerated: string;
  let docArchived: string;
  let app: BuiltApp | undefined;
  const providers: HocuspocusProvider[] = [];
  const sockets: WebSocket[] = [];

  function trackSocket(raw: WebSocket): WebSocket {
    // A rejected upgrade (403/401) never establishes a connection; without a listener, `ws` re-throws
    // that as an unhandled 'error' event once the test calls `.terminate()` on it in `afterEach`.
    raw.on('error', () => {});
    sockets.push(raw);
    return raw;
  }

  beforeAll(async () => {
    pg = await openTestPg();
    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
    otherProject = await createProjectFixture(pg, { orgId: org.id });

    const built = buildServer({ env: ISOLATION_TEST_ENV, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    await built.ready();

    const owner = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const editor = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const viewer = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const outsider = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    const stranger = await seedUser(ISOLATION_TEST_ENV, pg.appPool);

    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: viewer.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: outsider.id, role: 'member' });
    // stranger: no membership row in `org` at all.

    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    // outsider has a project_members row only in `otherProject`, never `project` itself.
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [otherProject.id, outsider.id, org.id]);

    ownerCookie = await signIn(built, owner.email);
    editorCookie = await signIn(built, editor.email);
    viewerCookie = await signIn(built, viewer.email);
    outsiderCookie = await signIn(built, outsider.email);
    strangerCookie = await signIn(built, stranger.email);
    await built.close();

    docCollab = await insertDocument(pg, { orgId: org.id, projectId: project.id });
    docGenerated = await insertDocument(pg, { orgId: org.id, projectId: project.id, origin: 'generated', workflowState: 'published' });
    docArchived = await insertDocument(pg, { orgId: org.id, projectId: project.id, workflowState: 'archived' });
  });

  afterAll(async () => {
    await pg.close();
  });

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    for (const socket of sockets.splice(0)) socket.terminate();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  test('rejects a WS upgrade with no Origin header', async () => {
    const started = await startApp({ pool: pg.appPool });
    app = started.app;
    const raw = trackSocket(new WebSocket(started.url));
    const failure = await new Promise<{ statusCode: number }>((resolve) => {
      raw.once('unexpected-response', (_req, res) => resolve({ statusCode: res.statusCode ?? 0 }));
    });
    expect(failure.statusCode).toBe(403);
  });

  test('rejects an untrusted Origin', async () => {
    const started = await startApp({ pool: pg.appPool });
    app = started.app;
    const raw = trackSocket(new WebSocket(started.url, { headers: { origin: 'https://evil.test' } }));
    const failure = await new Promise<{ statusCode: number }>((resolve) => {
      raw.once('unexpected-response', (_req, res) => resolve({ statusCode: res.statusCode ?? 0 }));
    });
    expect(failure.statusCode).toBe(403);
  });

  test('rejects a trusted Origin with no valid session cookie', async () => {
    const started = await startApp({ pool: pg.appPool });
    app = started.app;
    const raw = trackSocket(new WebSocket(started.url, { headers: { origin: ISOLATION_ORIGIN } }));
    const failure = await new Promise<{ statusCode: number }>((resolve) => {
      raw.once('unexpected-response', (_req, res) => resolve({ statusCode: res.statusCode ?? 0 }));
    });
    expect(failure.statusCode).toBe(401);
  });

  test('an editor connects read-write to a collab-origin draft document', async () => {
    // Its own document (never `docCollab`): Hocuspocus flushes the debounced store immediately once
    // every connection to a document closes, so an edit made here would otherwise leak into whichever
    // test connects to the shared `docCollab` fixture next.
    const doc = await insertDocument(pg, { orgId: org.id, projectId: project.id });
    let url: string;
    ({ app, url } = await startApp({ pool: pg.appPool }));
    const editorProvider = makeProvider(url, `${project.id}:${doc}`, { cookie: editorCookie, origin: ISOLATION_ORIGIN });
    const ownerProvider = makeProvider(url, `${project.id}:${doc}`, { cookie: ownerCookie, origin: ISOLATION_ORIGIN });
    providers.push(editorProvider, ownerProvider);
    await Promise.all([onceSynced(editorProvider), onceSynced(ownerProvider)]);

    editorProvider.document.getText('body').insert(0, 'written by editor');
    await new Promise<void>((resolve) => {
      ownerProvider.document.getText('body').observe(function handler() {
        if (ownerProvider.document.getText('body').toString() === 'written by editor') {
          ownerProvider.document.getText('body').unobserve(handler);
          resolve();
        }
      });
    });
    expect(ownerProvider.document.getText('body').toString()).toBe('written by editor');
  });

  test('a viewer connects read-only: their edits never reach another connection', async () => {
    const doc = await insertDocument(pg, { orgId: org.id, projectId: project.id });
    let url: string;
    ({ app, url } = await startApp({ pool: pg.appPool }));
    const viewerProvider = makeProvider(url, `${project.id}:${doc}`, { cookie: viewerCookie, origin: ISOLATION_ORIGIN });
    providers.push(viewerProvider);
    await onceSynced(viewerProvider);
    viewerProvider.document.getText('body').insert(0, 'should never sync');

    const observerProvider = makeProvider(url, `${project.id}:${doc}`, { cookie: ownerCookie, origin: ISOLATION_ORIGIN });
    providers.push(observerProvider);
    await onceSynced(observerProvider);
    expect(observerProvider.document.getText('body').toString()).toBe('');
  });

  test('rejects a same-org user with no project_members row for this project', async () => {
    let url: string;
    ({ app, url } = await startApp({ pool: pg.appPool }));
    const outsiderProvider = makeProvider(url, `${project.id}:${docCollab}`, { cookie: outsiderCookie, origin: ISOLATION_ORIGIN });
    providers.push(outsiderProvider);
    const failure = await onceAuthenticationFailed(outsiderProvider);
    expect(failure.reason).toBe('permission-denied');
  });

  test('rejects a caller who is not even a member of the document\'s organization', async () => {
    let url: string;
    ({ app, url } = await startApp({ pool: pg.appPool }));
    const strangerProvider = makeProvider(url, `${project.id}:${docCollab}`, { cookie: strangerCookie, origin: ISOLATION_ORIGIN });
    providers.push(strangerProvider);
    const failure = await onceAuthenticationFailed(strangerProvider);
    expect(failure.reason).toBe('permission-denied');
  });

  test('forces read-only for a generated-origin document even for an editor', async () => {
    let url: string;
    ({ app, url } = await startApp({ pool: pg.appPool }));
    const editorProvider = makeProvider(url, `${project.id}:${docGenerated}`, { cookie: editorCookie, origin: ISOLATION_ORIGIN });
    providers.push(editorProvider);
    await onceSynced(editorProvider);
    editorProvider.document.getText('body').insert(0, 'should never sync (generated)');

    const observerProvider = makeProvider(url, `${project.id}:${docGenerated}`, { cookie: ownerCookie, origin: ISOLATION_ORIGIN });
    providers.push(observerProvider);
    await onceSynced(observerProvider);
    expect(observerProvider.document.getText('body').toString()).toBe('');
  });

  test('forces read-only for an archived document even for an editor', async () => {
    let url: string;
    ({ app, url } = await startApp({ pool: pg.appPool }));
    const editorProvider = makeProvider(url, `${project.id}:${docArchived}`, { cookie: editorCookie, origin: ISOLATION_ORIGIN });
    providers.push(editorProvider);
    await onceSynced(editorProvider);
    editorProvider.document.getText('body').insert(0, 'should never sync (archived)');

    const observerProvider = makeProvider(url, `${project.id}:${docArchived}`, { cookie: ownerCookie, origin: ISOLATION_ORIGIN });
    providers.push(observerProvider);
    await onceSynced(observerProvider);
    expect(observerProvider.document.getText('body').toString()).toBe('');
  });

  test('rejects a documentName whose project does not match the document\'s real project', async () => {
    let url: string;
    ({ app, url } = await startApp({ pool: pg.appPool }));
    const mismatchedProvider = makeProvider(url, `${otherProject.id}:${docCollab}`, { cookie: ownerCookie, origin: ISOLATION_ORIGIN });
    providers.push(mismatchedProvider);
    const failure = await onceAuthenticationFailed(mismatchedProvider);
    expect(failure.reason).toBe('permission-denied');
  });
});
