/**
 * WO-154 — `GET .../documents/:docId/blame`: reconstructs blame from real `doc_updates` rows and serves
 * it to any project member (viewer included, per SDD-008 §"Servidor de tiempo real": "Todos los miembros
 * del proyecto pueden ver la copia de trabajo en solo lectura"), and the cache invalidates once
 * `doc_updates`' highest `seq` for the document moves.
 */
import { randomUUID } from 'node:crypto';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';
import { createBlameBroadcastExtension, BLAME_STALE_MESSAGE } from '../../src/collab/blame.js';

describe('GET .../documents/:docId/blame (WO-154)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
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

  async function createDocumentFixture(orgId: string, projectId: string): Promise<string> {
    const id = randomUUID();
    const docId = `PRD-${id.slice(0, 8)}`;
    await pg.ownerPool.query(
      `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
       VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/x.md', 'collab', 'draft')`,
      [id, orgId, projectId, docId],
    );
    return id;
  }

  /** `shared` tracks the document's cumulative state across calls, like a real Hocuspocus-hosted `Y.Doc`
   * would — each call gives the acting user a *fresh* client id synced from `shared`'s current state
   * (never the same client id two different users share) before mutating and re-merging, so sequential
   * inserts land in the right order instead of Yjs treating them as two independent, position-0-relative
   * documents. */
  async function insertDocUpdate(shared: Y.Doc, orgId: string, documentId: string, seq: number, actorId: string, mutate: (doc: Y.Doc) => void): Promise<void> {
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

  test('viewer can fetch blame; two attributed updates resolve to their own authors', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, viewer, org, project } = await setupOrgAndProject();
    const viewerCookie = await signIn(app, viewer.email);
    const documentId = await createDocumentFixture(org.id, project.id);

    const shared = new Y.Doc({ gc: false });
    await insertDocUpdate(shared, org.id, documentId, 1, editor.id, (doc) => doc.getText('body').insert(0, 'editor line\n'));
    await insertDocUpdate(shared, org.id, documentId, 2, viewer.id, (doc) => doc.getText('body').insert(doc.getText('body').length, 'viewer line'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${(await pg.ownerPool.query('SELECT doc_id FROM documents WHERE id = $1', [documentId])).rows[0].doc_id}/blame`,
      headers: { ...AUTH_HOST, cookie: viewerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0].attribution.userId).toBe(editor.id);
    expect(body.lines[1].attribution.userId).toBe(viewer.id);

    await app.close();
  });

  test('an org member with no project membership gets 404, never blame content', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project } = await setupOrgAndProject();
    const outsider = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: outsider.id, role: 'member' });
    const outsiderCookie = await signIn(app, outsider.email);
    const documentId = await createDocumentFixture(org.id, project.id);
    const [{ doc_id: docId }] = (await pg.ownerPool.query('SELECT doc_id FROM documents WHERE id = $1', [documentId])).rows;

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/blame`,
      headers: { ...AUTH_HOST, cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  test('blame cache recomputes once doc_updates gains a new row (new max seq)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { editor, org, project } = await setupOrgAndProject();
    const editorCookie = await signIn(app, editor.email);
    const documentId = await createDocumentFixture(org.id, project.id);
    const [{ doc_id: docId }] = (await pg.ownerPool.query('SELECT doc_id FROM documents WHERE id = $1', [documentId])).rows;

    const shared = new Y.Doc({ gc: false });
    await insertDocUpdate(shared, org.id, documentId, 1, editor.id, (doc) => doc.getText('body').insert(0, 'first'));
    const url = `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${docId}/blame`;
    const first = await app.inject({ method: 'GET', url, headers: { ...AUTH_HOST, cookie: editorCookie } });
    expect(first.json().lines).toHaveLength(1);

    await insertDocUpdate(shared, org.id, documentId, 2, editor.id, (doc) => doc.getText('body').insert(0, 'second\n'));
    const second = await app.inject({ method: 'GET', url, headers: { ...AUTH_HOST, cookie: editorCookie } });
    // The freshly-recomputed blame reflects the new row's content shape (2 lines now), proving the cache
    // didn't just replay the first response.
    expect(second.json().lines).toHaveLength(2);

    await app.close();
  });
});

describe('createBlameBroadcastExtension (WO-154)', () => {
  test('broadcasts a blame:stale stateless message after every store', async () => {
    const broadcastStateless = vi.fn();
    const extension = createBlameBroadcastExtension();
    await extension.onStoreDocument({ document: { broadcastStateless } });
    expect(broadcastStateless).toHaveBeenCalledWith(BLAME_STALE_MESSAGE);
    expect(JSON.parse(BLAME_STALE_MESSAGE)).toEqual({ type: 'blame:stale' });
  });
});
