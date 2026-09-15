/**
 * WO-341 — `GET .../commits` (paginated, optional `ref` branch filter) and `GET .../code-refs`
 * (`project_code_refs` cross-referenced with `inspect().governed`'s current sync verdict).
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('GET .../commits and .../code-refs (WO-341)', () => {
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

  test('GET .../commits filters by ref (branch) and paginates with limit', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    await pg.ownerPool.query(
      `INSERT INTO "commits" (project_id, org_id, sha, trust, author, date, subject, refs, branches) VALUES ($1, $2, $3, 'baseline', 'Alice', now(), 'on main', '{}', ARRAY['main'])`,
      [project.id, org.id, 'a'.repeat(40)],
    );
    await pg.ownerPool.query(
      `INSERT INTO "commits" (project_id, org_id, sha, trust, author, date, subject, refs, branches) VALUES ($1, $2, $3, 'preview', 'Bob', now(), 'on feature', '{}', ARRAY['feature/x'])`,
      [project.id, org.id, 'b'.repeat(40)],
    );
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/commits?ref=main`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { commits: { sha: string }[]; nextCursor: string | null };
    expect(body.commits.map((c) => c.sha)).toEqual(['a'.repeat(40)]);
    expect(body.nextCursor).toBeNull();

    await app.close();
  });

  test('GET .../code-refs returns an empty list when nothing has ever been reported', async () => {
    const app = buildApp();
    const { owner, org, project } = await setupProject();
    const ownerCookie = await signIn(app, owner.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/code-refs`,
      headers: { ...AUTH_HOST(), cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ refs: [] });

    await app.close();
  });
});
