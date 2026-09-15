/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports` (SDD-010 §Dashboard,
 * WO-199): official drift for the default branch (token + head_sha), preview drift by branch, and the
 * full report history — built from whatever `POST .../code-reports` (WO-180/WO-181) already recorded.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('GET /api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports (WO-199)', () => {
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

  async function seedOwnerAndCiToken(app: ReturnType<typeof buildServer>, name: string) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name, scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const { rows } = await pg.ownerPool.query(`SELECT id FROM api_tokens WHERE name = $1 ORDER BY created_at DESC LIMIT 1`, [name]);
    return { org, project, secret: created.json().secret as string, tokenId: rows[0].id as string, ownerCookie: cookie };
  }

  function baseReport(overrides: Record<string, unknown> = {}) {
    return {
      schema_version: 1,
      client: { prdm_version: '0.2.0', hash_algo_version: 1 },
      branch: 'feature/x',
      head_sha: 'a'.repeat(40),
      docs_graph_version: '0',
      impacts_hashes: {},
      governed: [],
      governed_warnings: [],
      commits: [],
      dirty: [],
      ...overrides,
    };
  }

  test('an empty project has no official report and empty previews/history', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, ownerCookie } = await seedOwnerAndCiToken(app, 'ci-pipeline');

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/reports`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ official: null, previews: [], history: [] });

    await app.close();
  });

  test('lists preview reports grouped by branch and the full history, never showing a preview as official', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, secret, ownerCookie } = await seedOwnerAndCiToken(app, 'ci-pipeline');

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'key-x' },
      payload: baseReport({ branch: 'feature/x', head_sha: 'a'.repeat(40) }),
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'key-y' },
      payload: baseReport({ branch: 'feature/y', head_sha: 'b'.repeat(40) }),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/reports`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.official).toBeNull();
    expect(body.previews).toHaveLength(2);
    expect(body.previews.every((r: { mode: string }) => r.mode === 'preview')).toBe(true);
    expect(new Set(body.previews.map((r: { branch: string }) => r.branch))).toEqual(new Set(['feature/x', 'feature/y']));
    expect(body.previews.every((r: { tokenName: string }) => r.tokenName === 'ci-pipeline')).toBe(true);
    expect(body.history).toHaveLength(2);
    // Newest first.
    expect(body.history[0].headSha).toBe('b'.repeat(40));
    expect(body.history[1].headSha).toBe('a'.repeat(40));

    await app.close();
  });

  test('surfaces a baseline report as the official one, distinct from any preview', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, secret, tokenId, ownerCookie } = await seedOwnerAndCiToken(app, 'ci-pipeline');

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'key-preview' },
      payload: baseReport({ branch: 'feature/x', head_sha: 'a'.repeat(40) }),
    });

    // A verified GitHub OIDC baseline report is exercised end to end by code-reports-baseline.test.ts
    // (WO-181); here we only need a `code_reports` row with `mode = 'baseline'` already recorded, so we
    // insert it directly rather than re-deriving a whole test JWKS/OIDC fixture.
    await pg.ownerPool.query(
      `INSERT INTO code_reports (project_id, org_id, token_id, idempotency_key, body_sha256, mode, head_sha, branch, result)
       VALUES ($1, $2, $3, 'key-baseline', 'deadbeef', 'baseline', $4, 'main', $5::jsonb)`,
      [project.id, org.id, tokenId, 'c'.repeat(40), JSON.stringify({ mode: 'baseline', reportId: 'r1', headSha: 'c'.repeat(40), issues: [], hasBlockingIssues: false })],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/reports`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.official).not.toBeNull();
    expect(body.official.mode).toBe('baseline');
    expect(body.official.headSha).toBe('c'.repeat(40));
    expect(body.official.tokenName).toBe('ci-pipeline');
    expect(body.official.branch).toBe('main');
    expect(body.previews).toHaveLength(1);
    expect(body.previews[0].mode).toBe('preview');
    expect(body.history).toHaveLength(2);

    await app.close();
  });

  test('a user with no membership in the project gets 404, not the drift history', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const outsider = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await createMemberFixture(pg, { organizationId: org.id, userId: outsider.id, role: 'member' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const outsiderCookie = await signIn(app, outsider.email);

    const res = await app.inject({
      method: 'GET',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/drift/reports`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
