/**
 * `GET /api/v1/projects/:graphProjectId/governance` (SDD-010, WO-178): ETag by `graph_version`,
 * scope `governance:read`, IDOR-safe cross-tenant 404s.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('GET /api/v1/projects/:graphProjectId/governance (WO-178)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  const ORIGIN = env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';
  const DAY_MS = 24 * 60 * 60 * 1000;

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

  async function issueCiToken(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, cookie: string, scopes: string[]) {
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name: 'ci-pipeline', scopes, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(created.statusCode).toBe(200);
    return created.json().secret as string;
  }

  async function seedOwnerAndProject(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    return { owner, org, project, cookie };
  }

  async function publishDoc(projectId: string, orgId: string, docId: string, content: string) {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, $3, 'PRD', 'Title', $4, 'generated', 'published', $5, 'deadbeef')`,
      [orgId, projectId, docId, `docs/prd/${docId}.md`, content],
    );
  }

  test('returns settings and published documents, and 404s for a wrong org token', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    await publishDoc(project.id, org.id, 'PRD-001', '# hello');
    const secret = await issueCiToken(app, org, project, cookie, ['governance:read']);

    const ok = await app.inject({ method: 'GET', url: `/api/v1/projects/${project.graphProjectId}/governance`, headers: { authorization: `Bearer ${secret}` } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.graphVersion).toBe('0');
    expect(body.documents).toEqual([{ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md', content: '# hello' }]);
    expect(ok.headers.etag).toBe('"0"');

    // A token from a different org must get the same 404 as a nonexistent project (no IDOR signal).
    const other = await seedOwnerAndProject(app);
    const otherSecret = await issueCiToken(app, other.org, other.project, other.cookie, ['governance:read']);
    const cross = await app.inject({ method: 'GET', url: `/api/v1/projects/${project.graphProjectId}/governance`, headers: { authorization: `Bearer ${otherSecret}` } });
    expect(cross.statusCode).toBe(404);

    const missing = await app.inject({ method: 'GET', url: `/api/v1/projects/prj_0000000000000000/governance`, headers: { authorization: `Bearer ${secret}` } });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  test('returns 304 when If-None-Match matches the current graph_version', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issueCiToken(app, org, project, cookie, ['governance:read']);

    const notModified = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.graphProjectId}/governance`,
      headers: { authorization: `Bearer ${secret}`, 'if-none-match': '"0"' },
    });
    expect(notModified.statusCode).toBe(304);

    await app.close();
  });

  test('a token scoped to other project_ids gets 404 for this project', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const otherProject = await createProjectFixture(pg, { orgId: org.id });

    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${otherProject.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name: 'ci-pipeline', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;

    const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${project.graphProjectId}/governance`, headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  test('a token without governance:read gets 403', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issueCiToken(app, org, project, cookie, ['reports:write']);

    const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${project.graphProjectId}/governance`, headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(403);

    await app.close();
  });
});
