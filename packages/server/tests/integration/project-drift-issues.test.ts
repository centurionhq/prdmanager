/**
 * WO-340 — `GET .../drift/issues` and `GET .../drift/reports/:reportId`: `inspect()`'s issues enriched
 * with `attributeIssue`, and a `code_reports` row unfolded into its individual issues.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createCiToken, recordCodeReport } from '@prdm/db';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('GET .../drift/issues and .../drift/reports/:reportId (WO-340)', () => {
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

  test('GET .../drift/issues attributes a lifecycle_violation to its feature and definicion station', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();
    const featureContent = '---\nid: FR-001\ntype: FR\ntitle: "Example feature"\njustified_by: []\n---\n\n## Solicitud\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $3)`,
      [org.id, project.id, featureContent],
    );
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/issues`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { issues: { kind: string; nodeId: string; featureIds: string[]; station: string | null; id: string }[] };
    const issue = body.issues.find((i) => i.kind === 'lifecycle_violation' && i.nodeId === 'FR-001');
    expect(issue).toBeDefined();
    expect(issue).toMatchObject({ featureIds: ['FR-001'], station: 'definicion' });
    expect(issue!.id).toMatch(/^[0-9a-f]+$/);

    await app.close();
  });

  test('GET .../drift/reports/:reportId 404s for a report belonging to a different project', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const projectA = await createProjectFixture(pg, { orgId: org.id });
    const projectB = await createProjectFixture(pg, { orgId: org.id });
    for (const project of [projectA, projectB]) {
      const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
      await store.clear();
    }
    const ciToken = await createCiToken(pg.appPool, {
      orgId: org.id,
      projectIds: [projectB.id],
      name: 'ci token',
      scopes: ['reports:write'],
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: owner.id,
    });
    const headSha = 'a'.repeat(40);
    const outcome = await recordCodeReport(pg.appPool, {
      projectId: projectB.id,
      orgId: org.id,
      tokenId: ciToken.record.id,
      idempotencyKey: 'k1',
      bodySha256: 'b1',
      mode: 'baseline',
      headSha,
      branch: 'main',
      result: { mode: 'baseline', reportId: 'placeholder', headSha, issues: [], hasBlockingIssues: false },
    });
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${projectA.slug}/drift/reports/${outcome.record.id}`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
