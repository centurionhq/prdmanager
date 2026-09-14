/**
 * WO-156 — manual save-with-label, automatic capture at request_review, listing and line diff. Real
 * Postgres, no live websocket needed: `doc_updates`/`documents.working_state` are seeded directly, the
 * same way `documents-blame.test.ts` (WO-154) simulates "the editor was actually opened and edited".
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('.../documents/:docId/versions* (WO-156)', () => {
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
    const editor = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: editor.id, role: 'member' });
    await createMemberFixture(pg, { organizationId: org.id, userId: viewer.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [project.id, editor.id, org.id]);
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    return { editor, viewer, org, project };
  }

  /** Simulates "a live collab session actually inserted content", by writing a `doc_updates` row directly
   * (never through a real websocket) — same technique `documents-blame.test.ts` uses. */
  async function seedLiveEdit(orgId: string, documentId: string, actorId: string, mutate: (doc: Y.Doc) => void): Promise<void> {
    const doc = new Y.Doc({ gc: false });
    mutate(doc);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc));
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, user_id, struct_ranges, delete_ranges, update)
       VALUES ($1, $2, 1, 'user', $3, $4, $5, $6)`,
      [orgId, documentId, actorId, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );
  }

  async function createDocument(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, editorCookie: string): Promise<{ id: string; docId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { kind: 'PRD', title: 'Live Doc' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    return { id: body.document.id, docId: body.document.docId };
  }

  test('manual save-with-label captures the live Y.Doc as a new labeled version (editor+); viewer is forbidden', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, viewer, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const viewerCookie = await signIn(app, viewer.email);
    const document = await createDocument(app, org, project, editorCookie);

    await seedLiveEdit(org.id, document.id, editor.id, (doc) => {
      doc.getMap('fm').set('title', 'Captured Title');
      doc.getText('body').insert(0, 'Captured body content');
    });

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, viewerCookie),
      payload: { label: 'Milestone 1' },
    });
    expect(forbidden.statusCode).toBe(403);

    const saved = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { label: 'Milestone 1' },
    });
    expect(saved.statusCode).toBe(200);
    const version = saved.json().version;
    expect(version.versionNo).toBe(2);
    expect(version.label).toBe('Milestone 1');
    expect(version.reason).toBe('manual');
    expect(version.renderedMarkdown).toContain('Captured body content');
    expect(version.contributors).toContain(editor.id);

    const list = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: { ...AUTH_HOST, cookie: viewerCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);

    const diff = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/2/diff?against=1`,
      headers: { ...AUTH_HOST, cookie: viewerCookie },
    });
    expect(diff.statusCode).toBe(200);
    const diffBody = diff.json();
    expect(diffBody.diff.some((op: { type: string; line: string }) => op.type === 'added' && op.line.includes('Captured body content'))).toBe(true);

    await app.close();
  });

  test('manual save is rejected (409) when the document has no live collab history yet', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const document = await createDocument(app, org, project, editorCookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { label: 'Too early' },
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  test('request-review captures an automatic version only when there is live collab history', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);

    // Never touched via collab: request-review still succeeds but must not fabricate an empty version.
    const untouched = await createDocument(app, org, project, editorCookie);
    const untouchedReview = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${untouched.docId}/request-review`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
    });
    expect(untouchedReview.statusCode).toBe(200);
    const untouchedVersions = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${untouched.docId}/versions`,
      headers: { ...AUTH_HOST, cookie: editorCookie },
    });
    expect(untouchedVersions.json().versions).toHaveLength(1);

    // Actually edited via collab: request-review captures a new review_request version.
    const edited = await createDocument(app, org, project, editorCookie);
    await seedLiveEdit(org.id, edited.id, editor.id, (doc) => doc.getText('body').insert(0, 'Ready for review'));
    const editedReview = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${edited.docId}/request-review`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
    });
    expect(editedReview.statusCode).toBe(200);
    const editedVersions = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${edited.docId}/versions`,
      headers: { ...AUTH_HOST, cookie: editorCookie },
    });
    const versions = editedVersions.json().versions;
    expect(versions).toHaveLength(2);
    expect(versions[0].reason).toBe('review_request');
    expect(versions[0].renderedMarkdown).toContain('Ready for review');

    await app.close();
  });
});
