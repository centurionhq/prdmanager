/**
 * WO-336 — `GET .../organizations/:orgSlug/projects/overview`: one `ProjectOverviewDto` per project the
 * caller can see, memoized by `(projectId, graph_version, latestReportId)`.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('GET .../organizations/:orgSlug/projects/overview (WO-336)', () => {
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

  test('never includes a project the caller has no project_members row in', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const member = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    const visible = await createProjectFixture(pg, { orgId: org.id });
    const hidden = await createProjectFixture(pg, { orgId: org.id });
    for (const project of [visible, hidden]) {
      const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
      await store.clear();
    }
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [visible.id, member.id, org.id]);

    const memberCookie = await signIn(app, member.email);
    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/overview`,
      headers: { ...AUTH_HOST(), cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { projects: { id: string; myRole: string }[] };
    expect(body.projects.map((p) => p.id)).toEqual([visible.id]);
    expect(body.projects[0]?.myRole).toBe('viewer');

    await app.close();
  });

  test('computes docCount/furthestStation/driftErrors and does not rescan on a second call with an unchanged graph_version/latestReportId', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });

    const projects = await Promise.all(Array.from({ length: 20 }, () => createProjectFixture(pg, { orgId: org.id })));
    for (const project of projects) {
      const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
      await store.clear();
    }
    const featureContent = '---\nid: FR-001\ntype: FR\ntitle: "Example feature"\njustified_by: []\n---\n\n## Solicitud\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001.md', 'collab', 'published', $3)`,
      [org.id, projects[0]!.id, featureContent],
    );

    const scanSpy = vi.spyOn(PgProjectEngine.prototype, 'scan');
    const ownerCookie = await signIn(app, owner.email);

    const first = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/overview`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { projects: { id: string; docCount: number; furthestStation: string; driftErrors: number }[] };
    const withFeature = firstBody.projects.find((p) => p.id === projects[0]!.id)!;
    expect(withFeature.docCount).toBe(1);
    expect(withFeature.furthestStation).toBe('entrada');
    expect(withFeature.driftErrors).toBeGreaterThan(0);
    expect(scanSpy).toHaveBeenCalledTimes(20);

    const second = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/overview`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(second.statusCode).toBe(200);
    expect(scanSpy).toHaveBeenCalledTimes(20);

    scanSpy.mockRestore();
    await app.close();
  });

  test('memberCount comes from one grouped query: A=1, B=3, C=0', async () => {
    const app = buildApp();
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const [a, b, c] = [await createProjectFixture(pg, { orgId: org.id }), await createProjectFixture(pg, { orgId: org.id }), await createProjectFixture(pg, { orgId: org.id })];
    for (const project of [a, b, c]) {
      const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
      await store.clear();
    }
    const users = [await seedUser(env, pg.appPool, PASSWORD), await seedUser(env, pg.appPool, PASSWORD), await seedUser(env, pg.appPool, PASSWORD)];
    const memberships: [string, string][] = [[a.id, users[0]!.id], [b.id, users[0]!.id], [b.id, users[1]!.id], [b.id, users[2]!.id]];
    for (const [projectId, userId] of memberships) {
      await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'viewer')`, [projectId, userId, org.id]);
    }

    const ownerCookie = await signIn(app, owner.email);
    // Tenant transactions run on a client from `pool.connect()`, so the statements are observed there.
    const statements: string[] = [];
    const wrapped = new WeakSet<object>();
    const originalConnect = pg.appPool.connect.bind(pg.appPool) as (...args: unknown[]) => Promise<{ query: (...args: unknown[]) => unknown }>;
    const connectSpy = vi.spyOn(pg.appPool, 'connect').mockImplementation((async (...args: unknown[]) => {
      const client = await originalConnect(...args);
      // Pooled clients are reused across connects: wrap each one only once or statements get counted twice.
      if (wrapped.has(client)) return client;
      wrapped.add(client);
      const originalQuery = client.query.bind(client);
      client.query = (...queryArgs: unknown[]) => {
        const first = queryArgs[0];
        statements.push(typeof first === 'string' ? first : String((first as { text?: string })?.text ?? ''));
        return originalQuery(...queryArgs);
      };
      return client;
    }) as never);
    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/overview`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { projects: { id: string; memberCount: number }[] };
    const countOf = (id: string) => body.projects.find((p) => p.id === id)?.memberCount;
    expect([countOf(a.id), countOf(b.id), countOf(c.id)]).toEqual([1, 3, 0]);
    expect(statements.filter((sql) => /group by/i.test(sql) && /project_members/i.test(sql))).toHaveLength(1);

    connectSpy.mockRestore();
    await app.close();
  });
});
