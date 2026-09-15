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
});
