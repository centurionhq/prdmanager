/**
 * WO-156 — manual save-with-label, automatic capture at request_review, listing and line diff. Real
 * Postgres, no live websocket needed: `doc_updates`/`documents.working_state` are seeded directly, the
 * same way `documents-blame.test.ts` (WO-154) simulates "the editor was actually opened and edited".
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import type { FrontmatterValue } from '@prdm/collab';
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

  /** Mechanically reads back exactly the fields/body a rendered markdown document already has, with no
   * schema validation and no defaults filled in (unlike `@prdm/core`'s `parseDocument`) — used only to
   * simulate "the live editor was opened and the exact same content it already had got written back",
   * never a real client's behavior. */
  function rawFrontmatterOf(markdown: string): { fields: Record<string, FrontmatterValue>; body: string } {
    const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(markdown);
    if (!match) throw new Error('no frontmatter block found');
    const [, block = '', body = ''] = match;
    const fields: Record<string, FrontmatterValue> = {};
    for (const line of block.split('\n')) {
      const kv = /^([a-z][a-z0-9_]*): (.*)$/.exec(line);
      if (!kv) continue;
      const key = kv[1] ?? '';
      const rawValue = kv[2] ?? '';
      fields[key] = rawValue.startsWith('"') || rawValue.startsWith('[') ? (JSON.parse(rawValue) as FrontmatterValue) : rawValue;
    }
    return { fields, body };
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

  // WO-217: version 1 (from `templateFor(kind)`, WO-136's draft creation) and every later
  // `captureDocumentVersion` snapshot must use the exact same frontmatter serialization convention.
  // Before the fix, the draft template's unquoted `type: PRD` survived untouched into version 1 while
  // `captureDocumentVersion` always re-quoted every field (`renderDocument`'s `JSON.stringify`), so
  // opening the editor and saving again with *no real edit* still produced a spurious `type: PRD` /
  // `type: "PRD"` diff line — pure serialization noise, not a real content change.
  test('a version captured with no actual field/body change produces a zero-line diff against the previous version', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const document = await createDocument(app, org, project, editorCookie);

    // WO-225: the list endpoint no longer includes `renderedMarkdown` (unused by the summary view) — the
    // diff endpoint still does, so fetch version 1's content that way instead.
    const version1Diff = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/1/diff?against=1`,
      headers: { ...AUTH_HOST, cookie: editorCookie },
    });
    const { fields, body } = rawFrontmatterOf(version1Diff.json().to.renderedMarkdown as string);
    const { id: _id, type: _type, title: _title, ...restFields } = fields;

    // Simulate opening the live editor and saving again without changing anything: seed the Y.Doc's
    // fm/body with exactly the values version 1 already has.
    await seedLiveEdit(org.id, document.id, editor.id, (doc) => {
      const fm = doc.getMap<FrontmatterValue>('fm');
      for (const [key, value] of Object.entries(restFields)) fm.set(key, value);
      fm.set('title', fields.title as string);
      doc.getText('body').insert(0, body);
    });

    const saved = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, editorCookie),
      payload: { label: 'No-op save' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().version.versionNo).toBe(2);

    const diff = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions/2/diff?against=1`,
      headers: { ...AUTH_HOST, cookie: editorCookie },
    });
    expect(diff.statusCode).toBe(200);
    const ops: { type: string; line: string }[] = diff.json().diff;
    expect(ops.every((op) => op.type === 'equal')).toBe(true);

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
    // WO-225: the list endpoint no longer includes `renderedMarkdown` — confirm the captured content via
    // the diff endpoint instead (still full summaries there).
    const editedDiff = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${edited.docId}/versions/${versions[0].versionNo}/diff?against=${versions[0].versionNo}`,
      headers: { ...AUTH_HOST, cookie: editorCookie },
    });
    expect(editedDiff.json().to.renderedMarkdown).toContain('Ready for review');

    await app.close();
  });

  // WO-225 (performance review, MEDIUM): the list endpoint used to `SELECT *`, pulling `yjs_state` (a full
  // snapshot buffer) and `renderedMarkdown` even though the summary view never returns either.
  test('the list endpoint never includes yjsState or renderedMarkdown, even for a version with a huge snapshot', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const document = await createDocument(app, org, project, editorCookie);

    // A version row is seeded directly (bypassing captureDocumentVersion) so its yjsState/renderedMarkdown
    // can be made deliberately huge — proving the list query itself never selects those columns, not just
    // that `toVersionSummary` happens to drop small ones.
    const hugeMarkdown = 'x'.repeat(200_000);
    const hugeYjsState = Buffer.alloc(200_000, 1);
    await pg.ownerPool.query(
      `INSERT INTO document_versions (org_id, document_id, version_no, reason, yjs_state, rendered_markdown, frontmatter, content_hash, contributors, created_by)
       VALUES ($1, $2, 2, 'manual', $3, $4, '{}'::jsonb, 'hash', '{}', $5)`,
      [org.id, document.id, hugeYjsState, hugeMarkdown, editor.id],
    );

    const list = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions`,
      headers: { ...AUTH_HOST, cookie: editorCookie },
    });
    expect(list.statusCode).toBe(200);
    const versionTwo = list.json().versions.find((v: { versionNo: number }) => v.versionNo === 2);
    expect(versionTwo).toBeDefined();
    expect(versionTwo).not.toHaveProperty('renderedMarkdown');
    expect(versionTwo).not.toHaveProperty('yjsState');
    // Cheap columns the summary view does use are still present.
    expect(versionTwo.contentHash).toBe('hash');

    await app.close();
  });

  test('the list endpoint paginates: requesting the next page never repeats an earlier version', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const document = await createDocument(app, org, project, editorCookie);

    // Version 1 already exists (draft creation); seed 4 more directly so there are 5 total.
    for (let i = 2; i <= 5; i += 1) {
      await pg.ownerPool.query(
        `INSERT INTO document_versions (org_id, document_id, version_no, reason, rendered_markdown, frontmatter, content_hash, contributors, created_by)
         VALUES ($1, $2, $3, 'manual', 'body', '{}'::jsonb, $4, '{}', $5)`,
        [org.id, document.id, i, `hash-${i}`, editor.id],
      );
    }

    async function listPage(limit: number, offset: number): Promise<{ versions: { versionNo: number }[]; total: number; limit: number; offset: number }> {
      const res = await app.inject({
        method: 'GET',
        url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/versions?limit=${limit}&offset=${offset}`,
        headers: { ...AUTH_HOST, cookie: editorCookie },
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    }

    const page1 = await listPage(2, 0);
    expect(page1.versions.map((v) => v.versionNo)).toEqual([5, 4]);
    expect(page1.total).toBe(5);

    const page2 = await listPage(2, 2);
    expect(page2.versions.map((v) => v.versionNo)).toEqual([3, 2]);

    const page3 = await listPage(2, 4);
    expect(page3.versions.map((v) => v.versionNo)).toEqual([1]);

    const allVersionNos = [...page1.versions, ...page2.versions, ...page3.versions].map((v) => v.versionNo);
    expect(new Set(allVersionNos).size).toBe(5); // no repeats across pages

    await app.close();
  });
});
