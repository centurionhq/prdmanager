/**
 * WO-157 — restoring a version applies the restored content as a server-attributed direct-connection
 * transaction: the live document's content changes to match the restored version, a new `reason:
 * 'restore'` version is captured, and — verified via WO-153's blame, not just a content check — every
 * restored line is attributed to the *restoring* user, never the original historical author.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { createBlameCache } from '../../src/collab/blame.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('.../documents/:docId/versions/:versionNo/restore (WO-157)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  const ORIGIN = env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function setupOrgAndProject() {
    const authorA = await seedUser(env, pg.appPool, PASSWORD);
    const restorerB = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    for (const u of [authorA, restorerB, viewer]) await createMemberFixture(pg, { organizationId: org.id, userId: u.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, authorA.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, restorerB.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    return { authorA, restorerB, viewer, org, project };
  }

  /** Appends one more `doc_updates` row on top of `shared`'s running state, attributed to `actorId` —
   * mirrors the real attribution pipeline's row shape without needing a live websocket connection. */
  async function seedLiveEdit(shared: Y.Doc, orgId: string, documentId: string, seq: number, actorId: string, mutate: (doc: Y.Doc) => void): Promise<void> {
    const clientDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(shared));
    const before = Y.encodeStateVector(clientDoc);
    mutate(clientDoc);
    const update = Buffer.from(Y.encodeStateAsUpdate(clientDoc, before));
    Y.applyUpdate(shared, update);
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, user_id, struct_ranges, delete_ranges, update)
       VALUES ($1, $2, $3, 'user', $4, $5, $6, $7)`,
      [orgId, documentId, seq, actorId, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );
  }

  async function createDocument(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, cookie: string): Promise<{ id: string; docId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { kind: 'PRD', title: 'Restorable Doc' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    return { id: body.document.id, docId: body.document.docId };
  }

  test('restoring an earlier version re-applies its content, attributed to the restorer, never the original author', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { authorA, restorerB, viewer, org, project } = await setupOrgAndProject();
    const authorCookie = await signIn(app, authorA.email);
    const restorerCookie = await signIn(app, restorerB.email);
    const viewerCookie = await signIn(app, viewer.email);
    const document = await createDocument(app, org, project, authorCookie);

    const shared = new Y.Doc({ gc: false });
    await seedLiveEdit(shared, org.id, document.id, 1, authorA.id, (doc) => doc.getText('body').insert(0, 'Alice original content'));

    const saved = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, authorCookie),
      payload: { label: 'Alice v1' },
    });
    expect(saved.statusCode).toBe(200);
    const targetVersionNo: number = saved.json().version.versionNo;

    // Content diverges after the captured version — this is what restoring must undo.
    await seedLiveEdit(shared, org.id, document.id, 2, authorA.id, (doc) => {
      doc.getText('body').delete(0, doc.getText('body').length);
      doc.getText('body').insert(0, 'Someone overwrote this later');
    });

    // A viewer cannot restore.
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/${targetVersionNo}/restore`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, viewerCookie),
    });
    expect(forbidden.statusCode).toBe(403);

    const restored = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/${targetVersionNo}/restore`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, restorerCookie),
    });
    expect(restored.statusCode).toBe(200);
    const restoredVersion = restored.json().version;
    expect(restoredVersion.reason).toBe('restore');
    expect(restoredVersion.renderedMarkdown).toContain('Alice original content');
    // History is never rewritten: a brand new version number, not version 1 reused.
    expect(restoredVersion.versionNo).toBeGreaterThan(targetVersionNo);

    const { rows } = await pg.ownerPool.query('SELECT working_state FROM documents WHERE id = $1', [document.id]);
    expect(rows[0].working_state).not.toBeNull();

    const blame = await createBlameCache().get(pg.appPool, org.id, document.id);
    expect(blame.lines.length).toBeGreaterThan(0);
    for (const line of blame.lines) {
      expect(line.attribution?.userId).toBe(restorerB.id);
      expect(line.attribution?.userId).not.toBe(authorA.id);
    }

    await app.close();
  });

  test('restoring a version with no captured snapshot is rejected (409)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { authorA, org, project } = await setupOrgAndProject();
    const authorCookie = await signIn(app, authorA.email);
    const document = await createDocument(app, org, project, authorCookie);
    // Version 1 (from createDraft) has no yjsState — it was never captured from a live Y.Doc.

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/1/restore`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, authorCookie),
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  test('restoring a version that does not exist is 404', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { authorA, org, project } = await setupOrgAndProject();
    const authorCookie = await signIn(app, authorA.email);
    const document = await createDocument(app, org, project, authorCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/999/restore`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, authorCookie),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
