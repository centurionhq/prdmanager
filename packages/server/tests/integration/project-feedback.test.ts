/**
 * WO-339 — `POST .../feedback`, `GET .../inbox`, `GET .../feedback/:docId/candidates`,
 * `POST .../feedback/:docId/triage`: the HTTP surface for `@prdm/core`'s `submitFeedback`/`triageText`/
 * `triageFeedback`.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('feedback submit/inbox/candidates/triage (WO-339)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const PASSWORD = 'correct-horse-battery-staple';

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
    env = buildTestServerEnv({ neo4j: config.neo4j });
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  function buildApp() {
    return buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j });
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function setupProject() {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    return { owner, org, project };
  }

  test('POST feedback creates an FB document and it shows up in the inbox', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    const ownerCookie = await signIn(app, owner.email);

    const submit = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/feedback`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { text: 'Customers keep asking for dark mode.', source: 'support' },
    });
    expect(submit.statusCode).toBe(200);
    const feedbackId = submit.json().result.id as string;
    expect(feedbackId).toMatch(/^FB-\d+$/);

    const inbox = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/inbox`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(inbox.statusCode).toBe(200);
    const items = inbox.json().items as { id: string; kind: string; status: string }[];
    expect(items).toHaveLength(1);
    expect(inbox.json().total).toBe(items.length);
    expect(items[0]).toMatchObject({ id: feedbackId, kind: 'FB', status: 'new' });

    await app.close();
  });

  test('GET candidates 404s for an unknown document', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/feedback/FB-999/candidates`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  test('POST triage rejects a collab-origin document with 409 pending_republish', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    const featureContent = '---\nid: FR-001\ntype: FR\ntitle: "Example feature"\njustified_by: []\n---\n\n## Solicitud\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, featureContent],
    );
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/feedback/FR-001/triage`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { root: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'pending_republish' });

    await app.close();
  });

  test('POST triage links a generated FB document to a feature via informs', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    const featureContent = '---\nid: FR-001\ntype: FR\ntitle: "Example feature"\njustified_by: []\n---\n\n## Solicitud\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'generated', 'published', $3)`,
      [org.id, project.id, featureContent],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FB-001', 'FB', 'Feedback', 'docs/feedback/FB-001.md', 'generated', 'published', $3)`,
      [org.id, project.id, '---\nid: FB-001\ntype: FB\ntitle: "Feedback"\nstatus: new\nsource: support\n---\n\nFeedback body.\n'],
    );
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/feedback/FB-001/triage`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { informs: ['FR-001'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ id: 'FB-001', linkedTo: ['FR-001'], applied: 'immediate' });

    await app.close();
  });

  interface SeedFb {
    n: number;
    createdAt?: string;
    source?: string;
    title?: string;
    body?: string;
    status?: string;
    origin?: 'generated' | 'collab';
  }

  async function seedFb(org: { id: string }, project: { id: string }, fb: SeedFb): Promise<string> {
    const id = `FB-${String(fb.n).padStart(3, '0')}`;
    const createdAt = fb.createdAt ?? '2026-01-01';
    const title = fb.title ?? `Feedback ${id}`;
    const raw = `---\nid: ${id}\ntype: FB\ntitle: "${title}"\nstatus: ${fb.status ?? 'new'}\ncreated_at: ${createdAt}\nsource: ${fb.source ?? 'support'}\n---\n\n${fb.body ?? 'Feedback body.'}\n`;
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'FB', $4, $5, $6, 'published', $7)`,
      [org.id, project.id, id, title, `docs/feedback/${id}.md`, fb.origin ?? 'generated', raw],
    );
    return id;
  }

  const base = (org: { slug: string }, project: { slug: string }) => `/api/app/organizations/${org.slug}/projects/${project.slug}`;

  async function getInbox(app: ReturnType<typeof buildServer>, cookie: string, org: { slug: string }, project: { slug: string }, query = '') {
    return app.inject({ method: 'GET', url: `${base(org, project)}/inbox${query}`, headers: { ...AUTH_HOST(), cookie } });
  }

  async function postJson(app: ReturnType<typeof buildServer>, cookie: string, url: string, payload: unknown) {
    return app.inject({ method: 'POST', url, headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, cookie), payload: payload as object });
  }

  test('GET inbox orders by receivedAt descending and paginates without overlap', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    await seedFb(org, project, { n: 1, createdAt: '2026-01-01' });
    await seedFb(org, project, { n: 2, createdAt: '2026-02-01' });
    await seedFb(org, project, { n: 3, createdAt: '2026-03-01' });
    const cookie = await signIn(app, owner.email);

    const all = (await getInbox(app, cookie, org, project)).json() as { items: { id: string }[]; total: number };
    expect(all.items.map((i) => i.id)).toEqual(['FB-003', 'FB-002', 'FB-001']);

    const page1 = (await getInbox(app, cookie, org, project, '?limit=2')).json() as { items: { id: string }[]; total: number };
    const page2 = (await getInbox(app, cookie, org, project, '?limit=2&offset=2')).json() as { items: { id: string }[]; total: number };
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    expect([...page1.items, ...page2.items].map((i) => i.id).sort()).toEqual(['FB-001', 'FB-002', 'FB-003']);

    expect((await getInbox(app, cookie, org, project, '?limit=201')).statusCode).toBe(400);
    await app.close();
  });

  test('GET inbox filters by q (case-insensitive over title and body), source and status', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    await seedFb(org, project, { n: 1, title: 'Modo Oscuro', body: 'nada especial', source: 'support' });
    await seedFb(org, project, { n: 2, title: 'Otro', body: 'Pedido de EXPORTAR a csv', source: 'chat' });
    await seedFb(org, project, { n: 3, title: 'Descartado', source: 'support', status: 'dismissed' });
    const cookie = await signIn(app, owner.email);
    const ids = async (query: string) => ((await getInbox(app, cookie, org, project, query)).json().items as { id: string }[]).map((i) => i.id);

    expect(await ids('?q=modo%20oscuro')).toEqual(['FB-001']);
    expect(await ids('?q=exportar')).toEqual(['FB-002']);
    expect(await ids('?q=inexistente')).toEqual([]);
    expect((await ids('?source=support')).sort()).toEqual(['FB-001', 'FB-003']);
    expect((await ids('?status=new')).sort()).toEqual(['FB-001', 'FB-002']);
    await app.close();
  });

  test('POST dismiss discards a generated FB, audits it, and refuses a second dismiss with 409', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    await seedFb(org, project, { n: 1 });
    const cookie = await signIn(app, owner.email);

    const res = await postJson(app, cookie, `${base(org, project)}/feedback/FB-001/dismiss`, { reason: 'ruido' });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ id: 'FB-001', status: 'dismissed', reason: 'ruido' });

    const dismissed = (await getInbox(app, cookie, org, project, '?status=dismissed')).json().items as { id: string }[];
    expect(dismissed.map((i) => i.id)).toEqual(['FB-001']);
    const audit = await pg.ownerPool.query(`SELECT 1 FROM "audit_log" WHERE action = 'feedback.dismissed' AND target = 'FB-001'`);
    expect(audit.rowCount).toBe(1);

    const again = await postJson(app, cookie, `${base(org, project)}/feedback/FB-001/dismiss`, {});
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  test('POST dismiss is forbidden for a project viewer', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const viewer = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: viewer.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [project.id, viewer.id, org.id]);
    await seedFb(org, project, { n: 1 });
    const cookie = await signIn(app, viewer.email);

    const res = await postJson(app, cookie, `${base(org, project)}/feedback/FB-001/dismiss`, {});
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  test('POST duplicate marks the item and rejects an unknown target with 409', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    await seedFb(org, project, { n: 1 });
    await seedFb(org, project, { n: 2 });
    const cookie = await signIn(app, owner.email);

    const ok = await postJson(app, cookie, `${base(org, project)}/feedback/FB-001/duplicate`, { duplicateOf: 'FB-002' });
    expect(ok.statusCode).toBe(200);
    const items = (await getInbox(app, cookie, org, project)).json().items as { id: string; status: string; duplicateOf: string | null }[];
    expect(items.find((i) => i.id === 'FB-001')).toMatchObject({ status: 'duplicate', duplicateOf: 'FB-002' });
    const audit = await pg.ownerPool.query(`SELECT 1 FROM "audit_log" WHERE action = 'feedback.marked_duplicate'`);
    expect(audit.rowCount).toBe(1);

    const bad = await postJson(app, cookie, `${base(org, project)}/feedback/FB-002/duplicate`, { duplicateOf: 'FB-099' });
    expect(bad.statusCode).toBe(409);
    await app.close();
  });

  test('POST triage-batch answers per item, including an already-triaged one', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    await seedFb(org, project, { n: 1 });
    await seedFb(org, project, { n: 2 });
    await seedFb(org, project, { n: 3, status: 'triaged' });
    const cookie = await signIn(app, owner.email);
    const url = `${base(org, project)}/feedback/triage-batch`;

    const clean = await postJson(app, cookie, url, { action: 'dismiss', ids: ['FB-001', 'FB-002'], reason: 'ruido' });
    expect(clean.statusCode).toBe(200);
    expect(clean.json().result).toMatchObject({ ok: 2, failed: 0, results: [{ id: 'FB-001', ok: true }, { id: 'FB-002', ok: true }] });

    const mixed = await postJson(app, cookie, url, { action: 'dismiss', ids: ['FB-003'] });
    expect(mixed.json().result.results[0]).toMatchObject({ id: 'FB-003', ok: false });
    expect(mixed.json().result).toMatchObject({ ok: 0, failed: 1 });
    await app.close();
  });

  test('POST triage-batch requires duplicateOf for duplicate and blocks collab-origin ids', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    await seedFb(org, project, { n: 1 });
    await seedFb(org, project, { n: 2, origin: 'collab' });
    const cookie = await signIn(app, owner.email);
    const url = `${base(org, project)}/feedback/triage-batch`;

    const missing = await postJson(app, cookie, url, { action: 'duplicate', ids: ['FB-001'] });
    expect(missing.statusCode).toBe(400);

    const res = await postJson(app, cookie, url, { action: 'dismiss', ids: ['FB-002', 'FB-001'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.results).toEqual([{ id: 'FB-002', ok: false, error: 'pending_republish' }, { id: 'FB-001', ok: true }]);
    expect(res.json().result).toMatchObject({ ok: 1, failed: 1 });
    await app.close();
  });
});
