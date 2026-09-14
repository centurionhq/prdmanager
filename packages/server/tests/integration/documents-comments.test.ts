/**
 * WO-158 — comment threads anchored on the live body: create, reply, resolve, reopen, delete-own (admin
 * deletes others'), permission gating, and the anchor surviving a concurrent edit elsewhere in the
 * document (SDD-008's own explicit test case).
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('.../documents/:docId/comments* (WO-158)', () => {
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
    const admin = await seedUser(env, pg.appPool, PASSWORD);
    const commenter = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    for (const u of [admin, commenter, viewer]) await createMemberFixture(pg, { organizationId: org.id, userId: u.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'admin')`, [project.id, admin.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'commenter')`, [project.id, commenter.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    return { admin, commenter, viewer, org, project };
  }

  async function createDocument(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, cookie: string): Promise<{ id: string; docId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { kind: 'PRD', title: 'Commented Doc' },
    });
    expect(res.statusCode).toBe(200);
    return { id: res.json().document.id, docId: res.json().document.docId };
  }

  async function seedLiveBody(orgId: string, documentId: string, text: string): Promise<void> {
    const doc = new Y.Doc({ gc: false });
    doc.getText('body').insert(0, text);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc));
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, struct_ranges, delete_ranges, update) VALUES ($1, $2, 1, 'system', $3, $4, $5)`,
      [orgId, documentId, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );
  }

  test('full lifecycle: create, reply, resolve, reopen, delete own; a viewer cannot comment', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { admin, commenter, viewer, org, project } = await setupOrgAndProject();
    const adminCookie = await signIn(app, admin.email);
    const commenterCookie = await signIn(app, commenter.email);
    const viewerCookie = await signIn(app, viewer.email);
    const document = await createDocument(app, org, project, adminCookie);
    await seedLiveBody(org.id, document.id, 'hello world, this is the body');

    const base = `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/comments`;

    const viewerForbidden = await app.inject({
      method: 'POST',
      url: base,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, viewerCookie),
      payload: { startIndex: 6, endIndex: 11, body: 'nice word' },
    });
    expect(viewerForbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, commenterCookie),
      payload: { startIndex: 6, endIndex: 11, body: 'nice word' },
    });
    expect(created.statusCode).toBe(200);
    const thread = created.json().thread;
    expect(thread.quotedText).toBe('world');
    expect(thread.status).toBe('open');
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0].body).toBe('nice word');

    // Viewer can still see comments (read-only).
    const listAsViewer = await app.inject({ method: 'GET', url: base, headers: { ...AUTH_HOST, cookie: viewerCookie } });
    expect(listAsViewer.statusCode).toBe(200);
    expect(listAsViewer.json().threads).toHaveLength(1);

    const reply = await app.inject({
      method: 'POST',
      url: `${base}/${thread.id}/replies`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, adminCookie),
      payload: { body: 'agreed' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().comment.body).toBe('agreed');

    const resolved = await app.inject({
      method: 'POST',
      url: `${base}/${thread.id}/resolve`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, commenterCookie),
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().thread.status).toBe('resolved');
    expect(resolved.json().thread.resolvedBy).toBe(commenter.id);
    expect(resolved.json().thread.comments).toHaveLength(2);

    const reopened = await app.inject({
      method: 'POST',
      url: `${base}/${thread.id}/reopen`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, commenterCookie),
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().thread.status).toBe('open');
    expect(reopened.json().thread.resolvedBy).toBeNull();

    // The commenter deletes their own opening comment.
    const ownCommentId = thread.comments[0].id;
    const deleteOwn = await app.inject({
      method: 'DELETE',
      url: `${base}/${thread.id}/messages/${ownCommentId}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, commenterCookie),
    });
    expect(deleteOwn.statusCode).toBe(200);
    expect(deleteOwn.json().comment.body).toBeNull();
    expect(deleteOwn.json().comment.deletedAt).not.toBeNull();

    await app.close();
  });

  test('deleting someone else\'s comment requires delete_others_comments (admin); a plain commenter is forbidden', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { admin, commenter, org, project } = await setupOrgAndProject();
    const adminCookie = await signIn(app, admin.email);
    const commenterCookie = await signIn(app, commenter.email);
    const otherCommenter = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: otherCommenter.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'commenter')`, [project.id, otherCommenter.id, org.id]);
    const otherCookie = await signIn(app, otherCommenter.email);

    const document = await createDocument(app, org, project, adminCookie);
    await seedLiveBody(org.id, document.id, 'hello world');
    const base = `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/comments`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, commenterCookie),
      payload: { startIndex: 0, endIndex: 5, body: 'hi' },
    });
    const thread = created.json().thread;
    const commentId = thread.comments[0].id;

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `${base}/${thread.id}/messages/${commentId}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, otherCookie),
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'DELETE',
      url: `${base}/${thread.id}/messages/${commentId}`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, adminCookie),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().comment.deletedAt).not.toBeNull();

    await app.close();
  });

  test('an anchor survives a concurrent edit elsewhere in the document', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { admin, commenter, org, project } = await setupOrgAndProject();
    const adminCookie = await signIn(app, admin.email);
    const commenterCookie = await signIn(app, commenter.email);
    const document = await createDocument(app, org, project, adminCookie);
    await seedLiveBody(org.id, document.id, 'hello world');
    const base = `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/comments`;

    const created = await app.inject({
      method: 'POST',
      url: base,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, commenterCookie),
      payload: { startIndex: 6, endIndex: 11, body: 'about world' },
    });
    expect(created.json().thread.quotedText).toBe('world');
    const threadId: string = created.json().thread.id;

    // A second, unrelated edit lands earlier in the body (e.g. via another live session), shifting every
    // later plain character offset — the anchor must not care. Built as a genuine causal continuation of
    // the document's *actual* current state (every prior doc_updates row replayed first, via the same
    // reconstruction logic the server itself uses) — a fresh, unsynced Y.Doc would make this "concurrent"
    // insert instead, whose merge position relative to "hello world" is undefined/non-deterministic.
    const { reconstructLiveYDoc } = await import('../../src/collab/reconstruct-ydoc.js');
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { ydoc: shared, updates } = await reconstructLiveYDoc(pg.appPool, org.id, document.id);
    const maxSeq = updates.reduce((max, row) => Math.max(max, row.seq), 0);
    const before = Y.encodeStateVector(shared);
    shared.getText('body').insert(0, 'PREFIX: ');
    const update = Buffer.from(Y.encodeStateAsUpdate(shared, before));
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, struct_ranges, delete_ranges, update) VALUES ($1, $2, $3, 'system', $4, $5, $6)`,
      [org.id, document.id, maxSeq + 1, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );

    const list = await app.inject({ method: 'GET', url: base, headers: { ...AUTH_HOST, cookie: commenterCookie } });
    const refetched = list.json().threads.find((t: { id: string }) => t.id === threadId);
    expect(refetched.quotedText).toBe('world');

    await app.close();
  });
});
