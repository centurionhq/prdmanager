/**
 * WO-220 — security review #2 (MEDIUM): live `/collab` revocation wired to better-auth's own session
 * lifecycle, not just `./revalidate.js`'s 60s safety-net poll. `../../src/auth/build-auth.ts` hooks
 * `databaseHooks.session.delete.after` (confirmed against the installed better-auth 1.7.4 source —
 * `db/internal-adapter.mjs`/`db/with-hooks.mjs` — every session-ending path funnels through
 * `deleteWithHooks`/`deleteManyWithHooks`, which fire this hook once per deleted session row, after the
 * delete has committed) to call the exact same `revocationHub.revokeUser` the instant-revocation call
 * sites in `../../src/api/projects.js`/`../../src/api/documents.js` already use.
 *
 * Same pattern as `./revocation.test.ts`'s own membership-removal tests: a real Fastify server, a real
 * `HocuspocusProvider` connection, and an event-driven `close` wait — never a wall-clock sleep.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, ISOLATION_TEST_ENV, signIn } from '../isolation/fixtures.js';
import { insertCollabDocumentFixture } from './document-fixture.js';
import { makeCollabProvider, onceSynced, startCollabApp } from './ws-test-helpers.js';

type BuiltApp = ReturnType<typeof buildServer>;
type Provider = ReturnType<typeof makeCollabProvider>;

const PASSWORD = 'correct-horse-battery-staple';

function onceClosed(provider: Provider): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      provider.off('close', handler);
      resolve();
    };
    provider.on('close', handler);
  });
}

describe('/collab revocation wired to better-auth session/password-change events (SDD-008, WO-220)', () => {
  let pg: PgTestDb;
  let org: { id: string; slug: string };
  let project: { id: string; slug: string };
  let app: BuiltApp;
  let url: string;
  const providers: Provider[] = [];

  beforeAll(async () => {
    pg = await openTestPg();
    org = await createOrganizationFixture(pg);
    project = await createProjectFixture(pg, { orgId: org.id });
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

  async function createSignedInMember(): Promise<{ id: string; email: string; cookie: string }> {
    const user = await seedUser(ISOLATION_TEST_ENV, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, user.id, org.id]);
    const cookie = await signIn(app, user.email);
    return { id: user.id, email: user.email, cookie };
  }

  test('signing out (session revoked) closes the user\'s open /collab connection instantly', async () => {
    const editor = await createSignedInMember();
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    const closed = onceClosed(provider);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      // `payload: {}` (rather than omitting it): better-auth's handler 415s a POST with no JSON
      // `content-type` at all, which `app.inject()` otherwise defaults an empty payload to.
      payload: {},
      headers: await mutationHeaders(app, ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, editor.cookie),
    });
    expect(res.statusCode).toBe(200);
    await closed;
  });

  test('revoking a single session closes the user\'s open /collab connection instantly', async () => {
    const editor = await createSignedInMember();
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: editor.cookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    // The DB's own `session.token` (never parsed out of the signed cookie value, whose exact encoding is
    // a better-auth implementation detail this test shouldn't need to know) — `/revoke-session` expects
    // this raw token in its body.
    const { rows } = await pg.ownerPool.query<{ token: string }>('SELECT token FROM "session" WHERE "userId" = $1', [editor.id]);
    const sessionToken = rows[0]!.token;

    const closed = onceClosed(provider);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/revoke-session',
      payload: { token: sessionToken },
      headers: await mutationHeaders(app, ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, editor.cookie),
    });
    expect(res.statusCode).toBe(200);
    await closed;
  });

  test('changing a password (which revokes other sessions) closes the user\'s open /collab connection instantly', async () => {
    const editor = await createSignedInMember();
    const doc = await insertCollabDocumentFixture(pg, { orgId: org.id, projectId: project.id });

    // A *second* session for the same user (a different signed-in browser) holds the live /collab
    // connection — exactly the case SDD-008 cares about: changing the password from one device must
    // close every other session's live connections, not just the one making the change.
    const otherSessionCookie = await signIn(app, editor.email);
    const provider = makeCollabProvider(url, `${project.id}:${doc}`, { cookie: otherSessionCookie, origin: ISOLATION_ORIGIN });
    providers.push(provider);
    await onceSynced(provider);

    const closed = onceClosed(provider);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: PASSWORD, newPassword: 'a-different-correct-horse-battery-staple' },
      headers: await mutationHeaders(app, ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, editor.cookie),
    });
    expect(res.statusCode).toBe(200);
    await closed;
  });
});
