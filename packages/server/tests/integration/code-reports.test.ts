/**
 * `POST /api/v1/projects/:graphProjectId/code-reports` (SDD-010, WO-180): idempotency by
 * `(project_id, token_id, Idempotency-Key)`, preview-by-default, and a real-concurrency front-running
 * test proving exactly one request ever writes.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('POST /api/v1/projects/:graphProjectId/code-reports (WO-180)', () => {
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

  async function seedOwnerAndCiToken(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name: 'ci-pipeline', scopes: ['reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;
    return { org, project, secret };
  }

  function baseReport(overrides: Record<string, unknown> = {}) {
    return {
      schema_version: 1,
      client: { prdm_version: '0.2.0', hash_algo_version: 1 },
      branch: 'main',
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

  test('accepts a valid report as a preview and returns a drift result', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project, secret } = await seedOwnerAndCiToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'key-1' },
      payload: baseReport(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('preview');
    expect(body.headSha).toBe('a'.repeat(40));
    expect(Array.isArray(body.issues)).toBe(true);

    await app.close();
  });

  test('rejects a report missing the Idempotency-Key header', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project, secret } = await seedOwnerAndCiToken(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}` },
      payload: baseReport(),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('rejects a stale docs_graph_version with 409 docs_outdated, without consuming the idempotency key', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project, secret } = await seedOwnerAndCiToken(app);

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'retry-key' },
      payload: baseReport({ docs_graph_version: '999' }),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('docs_outdated');

    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'retry-key' },
      payload: baseReport(),
    });
    expect(retry.statusCode).toBe(200);

    await app.close();
  });

  test('replays the original result for the same key and body, and rejects the same key with a different body', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project, secret } = await seedOwnerAndCiToken(app);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'key-a' },
      payload: baseReport(),
    });
    expect(first.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'key-a' },
      payload: baseReport(),
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().reportId).toBe(first.json().reportId);

    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'key-a' },
      payload: baseReport({ branch: 'other-branch' }),
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error).toBe('idempotency_mismatch');

    await app.close();
  });

  test('two real concurrent requests with the same idempotency key: exactly one writes, both see the same committed result (front-running, WO-180)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project, secret } = await seedOwnerAndCiToken(app);

    const url = `/api/v1/projects/${project.graphProjectId}/code-reports`;
    const headers = { authorization: `Bearer ${secret}`, 'idempotency-key': 'race-key' };
    const [resA, resB] = await Promise.all([
      app.inject({ method: 'POST', url, headers, payload: baseReport() }),
      app.inject({ method: 'POST', url, headers, payload: baseReport() }),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.json().reportId).toBe(resB.json().reportId);

    const { rows } = await pg.ownerPool.query(`SELECT count(*)::int AS count FROM "code_reports" WHERE idempotency_key = 'race-key'`);
    expect(rows[0].count).toBe(1);

    await app.close();
  });
});
