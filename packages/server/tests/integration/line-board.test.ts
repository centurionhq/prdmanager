/**
 * WO-335 — `GET .../line-board`: wraps `@prdm/core`'s `deriveLineBoard`/`attributeIssue`/`computeAndon`
 * over the project engine's `scan()` + `inspect()`, visible to any project member (`view`).
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('GET .../line-board (WO-335)', () => {
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

  test('places a feature on its station with no andon when there are no error issues', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const feedbackContent = '---\nid: FB-001\ntype: FB\ntitle: "Feedback"\nstatus: triaged\nsource: support\ninforms: ["FR-001"]\n---\n\nFeedback body.\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FB-001', 'FB', 'Feedback', 'docs/feedback/FB-001.md', 'generated', 'published', $3)`,
      [org.id, project.id, feedbackContent],
    );
    const featureContent = '---\nid: FR-001\ntype: FR\ntitle: "Example feature"\njustified_by: []\n---\n\n## Solicitud\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, featureContent],
    );

    const ownerCookie = await signIn(app, owner.email);
    // A brand-new document has no baseline yet, so its first `inspect()` reports it as `feature_changed`
    // (severity error) — acknowledging establishes the baseline so the line-board reflects steady state.
    const ack = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/acknowledge`,
      headers: await mutationHeaders(app, AUTH_HOST(), env.publicUrl, ownerCookie),
      payload: { target: 'all' },
    });
    expect(ack.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/line-board`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.features).toHaveLength(1);
    expect(body.features[0]).toMatchObject({ id: 'FR-001', station: 'definicion' });
    expect(body.andon).toBeNull();

    await app.close();
  });

  test('viewer without a project_members row gets 404, never 403', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const outsider = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: outsider.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const outsiderCookie = await signIn(app, outsider.email);
    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/line-board`,
      headers: { ...AUTH_HOST(), cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
