/**
 * WO-148 — integration tests for live revocation and periodic revalidation (SDD-008 §"Servidor de
 * tiempo real"). A real Fastify server, real `HocuspocusProvider` clients, a real Postgres test
 * database and a fake, manually-advanced `CollabScheduler` (`../../src/collab/scheduler.js`) — the
 * 60-second revalidation interval is triggered by calling `triggerAll()`, never by waiting out a real
 * timer.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer, type BuildServerDeps } from '../../src/build-server.js';
import { createFakeCollabScheduler, type FakeCollabScheduler } from '../../src/collab/scheduler.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceSynced } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;
type Provider = ReturnType<typeof makeCollabProvider>;

async function startApp(deps: Partial<BuildServerDeps>): Promise<{ app: BuiltApp; url: string }> {
  const app = buildServer({ env: ISOLATION_TEST_ENV, mailer: new FakeMailer(), logger: false, ...deps });
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

describe('/collab live revocation and periodic revalidation (SDD-008, WO-148)', () => {
  let pg: PgTestDb;
  let app: BuiltApp;
  let url: string;
  let scheduler: FakeCollabScheduler;
  let org: { id: string; slug: string };
  let project: { id: string; slug: string };
  let ownerCookie: string;
  let editorRemoved: { id: string; cookie: string };
  let editorDowngraded: { id: string; cookie: string };
  let editorRevalidatedRemoval: { id: string; cookie: string };
  let editorRevalidatedArchive: { id: string; cookie: string };
  const providers: Provider[] = [];

  // better-auth's own /sign-in/email rate limit is 5 per 15 minutes *per IP* (WO-095) — every
  // app.inject() call from this file shares one IP, so every user this suite ever signs in as is
  // created once here rather than per test (5 sign-ins total: the owner plus one editor per test that
  // needs its own project membership to mutate).
  async function createSignedInEditor(role: 'editor'): Promise<{ id: string; cookie: string }> {
    const editor = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, $4)`, [project.id, editor.id, org.id, role]);
    const cookie = await signIn(app, editor.email);
    return { id: editor.id, cookie };
  }

  beforeAll(async () => {
    pg = await openTestPg();
    scheduler = createFakeCollabScheduler();
    const started = await startApp({ pool: pg.appPool, collabScheduler: scheduler });
    app = started.app;
    url = started.url;

    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
    const owner = await seedUser(ISOLATION_TEST_ENV, pg.appPool);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    ownerCookie = await signIn(app, owner.email);

    editorRemoved = await createSignedInEditor('editor');
    editorDowngraded = await createSignedInEditor('editor');
    editorRevalidatedRemoval = await createSignedInEditor('editor');
    editorRevalidatedArchive = await createSignedInEditor('editor');
  });

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  afterEach(() => {
    for (const provider of providers.splice(0)) provider.destroy();
  });

  test('removing a member closes their open /collab connection to that project', async () => {
    const editor = editorRemoved;
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    const closed = onceClosed(provider);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members/${editor.id}`,
      headers: await mutationHeaders(app, ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, ownerCookie),
    });
    expect(res.statusCode).toBe(200);
    await closed;
  });

  test('downgrading a member\'s role closes their open /collab connection to that project', async () => {
    const editor = editorDowngraded;
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    const closed = onceClosed(provider);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/members/${editor.id}`,
      payload: { role: 'viewer' },
      headers: await mutationHeaders(app, ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, ownerCookie),
    });
    expect(res.statusCode).toBe(200);
    await closed;
  });

  test('archiving a document closes every open /collab connection to it', async () => {
    // Publish + archive requires a published document; drive the row directly (publishing itself is
    // WO-137's own route, orthogonal to this WO's revocation wiring) and use the owner (admin) session
    // both to connect and to archive, so this test only exercises the revocation call itself.
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id, workflowState: 'published' });
    const docId = `PRD-ARCHIVE-${doc.slice(0, 8)}`;
    await pg.ownerPool.query(`UPDATE documents SET doc_id = $2 WHERE id = $1`, [doc, docId]);

    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: ownerCookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    const closed = onceClosed(provider);
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/archive`,
      headers: await mutationHeaders(app, ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, ownerCookie),
    });
    expect(res.statusCode).toBe(200);
    await closed;
  });

  test('periodic revalidation closes a connection once the member has been removed', async () => {
    const editor = editorRevalidatedRemoval;
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    // Bypass the route (and its own revocation call) entirely: this test isolates the *periodic*
    // revalidation path from the *instant* revocation path exercised above.
    await pg.ownerPool.query(`DELETE FROM "project_members" WHERE project_id = $1 AND user_id = $2`, [project.id, editor.id]);

    const closed = onceClosed(provider);
    await scheduler.triggerAll();
    await closed;
  });

  test('periodic revalidation downgrades a connection to read-only once the document is archived', async () => {
    const editor = editorRevalidatedArchive;
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    provider.document.getText('body').insert(0, 'before archive');
    await pg.ownerPool.query(`UPDATE documents SET workflow_state = 'archived' WHERE id = $1`, [doc]);
    await scheduler.triggerAll();

    // Read-only now: an edit made after the tick above must never reach a fresh observer.
    provider.document.getText('body').insert(0, 'after archive (should not sync)');
    const observer = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: ownerCookie, origin: ISOLATION_ORIGIN });
    providers.push(observer);
    await onceSynced(observer);
    expect(observer.document.getText('body').toString()).toBe('before archive');
  });

  test('the revalidation interval is disposed once the connection closes', async () => {
    // Reuses the (now viewer-role, still a member) editor from the downgrade test above rather than
    // signing in a 6th user — better-auth's own sign-in rate limit is 5 per 15 minutes per IP (WO-095),
    // and every app.inject() call in this file shares one IP.
    const editor = editorDowngraded;
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const sizeBefore = scheduler.size;

    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);
    expect(scheduler.size).toBe(sizeBefore + 1);

    const disposed = scheduler.waitForNextDisposal();
    provider.destroy();
    await disposed;
    expect(scheduler.size).toBe(sizeBefore);
  });
});
