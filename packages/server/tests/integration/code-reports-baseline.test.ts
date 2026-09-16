/**
 * `POST .../code-reports` baseline mode (SDD-010 "Modo baseline de code-reports", WO-181): a
 * CI-scoped token with a verified GitHub Actions OIDC token earns baseline trust end to end — commits
 * are upserted, `project_code_state.latest_baseline_head_sha` advances, and `PgProjectEngine.refresh()`
 * runs. A feature-branch OIDC token (or none at all) silently stays preview; a regressing head without
 * an admin override is rejected.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { GITHUB_OIDC_ISSUER } from '../../src/auth/github-oidc.js';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const REPO_ID = '555000111';
const OWNER_ID = '777000333';
const DEFAULT_BRANCH = 'main';
const KID = 'test-key';

describe('POST /api/v1/projects/:graphProjectId/code-reports baseline mode (WO-181)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  let jwks: JWTVerifyGetKey;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const ORIGIN = () => env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
    env = buildTestServerEnv({ neo4j: config.neo4j });

    const { publicKey, privateKey: sk } = await generateKeyPair('RS256');
    privateKey = sk;
    const jwk = await exportJWK(publicKey);
    jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: 'RS256' }] });
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
    return buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j, githubOidcJwks: jwks });
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function signOidcToken(overrides: Record<string, unknown> = {}, headSha = 'a'.repeat(40)): Promise<string> {
    const claims = {
      repository_id: REPO_ID,
      repository_owner_id: OWNER_ID,
      ref: `refs/heads/${DEFAULT_BRANCH}`,
      event_name: 'push',
      sha: headSha,
      jti: `jti-${Math.random()}`,
      ...overrides,
    };
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: KID }).setIssuer(GITHUB_OIDC_ISSUER).setAudience(env.publicUrl).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  }

  async function setupProject(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    await pg.ownerPool.query(`UPDATE "projects" SET settings = $1 WHERE id = $2`, [
      JSON.stringify({ default_branch: DEFAULT_BRANCH, github_repository: 'acme/widgets', github_repository_id: Number(REPO_ID), github_owner_id: Number(OWNER_ID), hash_algo_version: 1 }),
      project.id,
    ]);
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { name: 'ci-pipeline', scopes: ['reports:write', 'reports:baseline'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;
    return { org, project, secret, cookie };
  }

  function baseReport(headSha: string, overrides: Record<string, unknown> = {}) {
    return {
      schema_version: 1,
      client: { prdm_version: '0.2.0', hash_algo_version: 1 },
      branch: DEFAULT_BRANCH,
      head_sha: headSha,
      docs_graph_version: '0',
      impacts_hashes: {},
      governed: [],
      governed_warnings: [],
      commits: [],
      dirty: [],
      ...overrides,
    };
  }

  test('a CI token with a verified OIDC token on the default branch earns baseline mode and writes commits/project_code_state', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    const headSha = 'a'.repeat(40);
    const oidcToken = await signOidcToken({}, headSha);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k1', 'x-prdm-github-oidc-token': oidcToken },
      payload: baseReport(headSha, { commits: [{ sha: headSha, parents: [],
        author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'feat: x\n\nRefs: WO-181', refs: ['WO-181'], files: ['x.ts'] }] }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('baseline');

    const { rows: commitRows } = await pg.ownerPool.query(`SELECT trust FROM "commits" WHERE project_id = $1 AND sha = $2`, [project.id, headSha]);
    expect(commitRows).toHaveLength(1);
    expect(commitRows[0].trust).toBe('baseline');

    const { rows: stateRows } = await pg.ownerPool.query(`SELECT latest_baseline_head_sha FROM "project_code_state" WHERE project_id = $1`, [project.id]);
    expect(stateRows[0].latest_baseline_head_sha).toBe(headSha);

    await app.close();
  });

  test('a feature-branch OIDC token silently falls to preview (not an error)', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    const headSha = 'b'.repeat(40);
    const oidcToken = await signOidcToken({ ref: 'refs/heads/feature-x' }, headSha);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k2', 'x-prdm-github-oidc-token': oidcToken },
      payload: baseReport(headSha),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('preview');

    await app.close();
  });

  test('no OIDC token at all silently falls to preview', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    const headSha = 'c'.repeat(40);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k3' },
      payload: baseReport(headSha),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('preview');

    await app.close();
  });

  test('a force-push (head regression) without an admin override is rejected; with an override it succeeds', async () => {
    const app = buildApp();
    const { org, project, secret, cookie } = await setupProject(app);

    const firstHead = 'd'.repeat(40);
    const firstOidc = await signOidcToken({}, firstHead);
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k4', 'x-prdm-github-oidc-token': firstOidc },
      payload: baseReport(firstHead, { commits: [{ sha: firstHead, parents: [],
        author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'x', refs: [], files: [] }] }),
    });
    expect(first.json().mode).toBe('baseline');

    // A regressed head (e.g. after a force-push) whose reported commits do not include the previously
    // registered head is rejected without an override.
    const regressedHead = 'e'.repeat(40);
    const regressedOidc = await signOidcToken({}, regressedHead);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k5', 'x-prdm-github-oidc-token': regressedOidc },
      payload: baseReport(regressedHead, { commits: [{ sha: regressedHead, parents: [],
        author: 'Alice', date: '2026-09-14T01:00:00.000Z', subject: 'y', refs: [], files: [] }] }),
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe('force_push_requires_admin_override');

    // An admin authorizes exactly that head_sha.
    const override = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/code-reports/force-push-overrides`,
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { headSha: regressedHead },
    });
    expect(override.statusCode).toBe(200);

    const overriddenOidc = await signOidcToken({}, regressedHead);
    const succeeded = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k6', 'x-prdm-github-oidc-token': overriddenOidc },
      payload: baseReport(regressedHead, { commits: [{ sha: regressedHead, parents: [],
        author: 'Alice', date: '2026-09-14T01:00:00.000Z', subject: 'y', refs: [], files: [] }] }),
    });
    expect(succeeded.statusCode).toBe(200);
    expect(succeeded.json().mode).toBe('baseline');

    // The override was consumed: retrying the same regressed head again (new report, new idempotency
    // key, same head_sha) is rejected again since the one-time override is gone.
    const secondRegressedHead = 'f'.repeat(40);
    const secondOidc = await signOidcToken({}, secondRegressedHead);
    const rejectedAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k7', 'x-prdm-github-oidc-token': secondOidc },
      payload: baseReport(secondRegressedHead, { commits: [{ sha: secondRegressedHead, parents: [],
        author: 'Alice', date: '2026-09-14T02:00:00.000Z', subject: 'z', refs: [], files: [] }] }),
    });
    expect(rejectedAgain.statusCode).toBe(409);

    await app.close();
  });

  test('a hash_algo_version mismatch silently falls to preview', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    const headSha = 'aa'.repeat(20);
    const oidcToken = await signOidcToken({}, headSha);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'k8', 'x-prdm-github-oidc-token': oidcToken },
      payload: baseReport(headSha, { client: { prdm_version: '0.2.0', hash_algo_version: 2 } }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('preview');

    await app.close();
  });

  test('two distinct, genuinely concurrent baseline reports for the same project never lose either side\'s impacts_hashes contribution (WO-233 real-concurrency)', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    // Same head_sha (e.g. two CI matrix jobs reporting on the exact same push, each covering a
    // different subset of blueprints) — the scenario that actually exercises the lost-update bug in
    // `recordBaselineHead`'s impacts_hashes merge, without also racing the force-push/regression gate.
    const headSha = 'a'.repeat(40);
    const [oidcA, oidcB] = await Promise.all([signOidcToken({}, headSha), signOidcToken({}, headSha)]);

    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
        headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'concurrent-a', 'x-prdm-github-oidc-token': oidcA },
        payload: baseReport(headSha, {
          impacts_hashes: { 'SDD-001': 'a'.repeat(64) },
          commits: [{ sha: headSha, parents: [], author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'x', refs: [], files: [] }],
        }),
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
        headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'concurrent-b', 'x-prdm-github-oidc-token': oidcB },
        payload: baseReport(headSha, {
          impacts_hashes: { 'SDD-002': 'b'.repeat(64) },
          commits: [{ sha: headSha, parents: [], author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'x', refs: [], files: [] }],
        }),
      }),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect(resA.json().mode).toBe('baseline');
    expect(resB.json().mode).toBe('baseline');

    const { rows } = await pg.ownerPool.query(`SELECT impacts_hashes, latest_baseline_head_sha FROM "project_code_state" WHERE project_id = $1`, [project.id]);
    expect(rows).toHaveLength(1);
    // Neither concurrent report's impacts_hashes entry was lost to the other's read-modify-write.
    expect(rows[0].impacts_hashes).toEqual({ 'SDD-001': 'a'.repeat(64), 'SDD-002': 'b'.repeat(64) });
    expect(rows[0].latest_baseline_head_sha).toBe(headSha);

    await app.close();
  }, 30_000);

  test('a baseline report persists project_code_refs and governed_warnings (WO-333)', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    const headSha = 'a'.repeat(40);
    const oidcToken = await signOidcToken({}, headSha);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'refs-1', 'x-prdm-github-oidc-token': oidcToken },
      payload: baseReport(headSha, {
        governed: [{ blueprintId: 'SDD-001', refs: [{ key: 'src/foo.ts', path: 'src/foo.ts', symbol: null, hash: 'b'.repeat(64) }] }],
        governed_warnings: [{ blueprintId: 'SDD-002', message: 'no files matched impacts_paths' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('baseline');

    const { rows: refRows } = await pg.ownerPool.query(`SELECT blueprint_id, ref_key, path, hash, hash_algo_version, head_sha FROM "project_code_refs" WHERE project_id = $1`, [project.id]);
    expect(refRows).toEqual([
      expect.objectContaining({ blueprint_id: 'SDD-001', ref_key: 'src/foo.ts', path: 'src/foo.ts', hash: 'b'.repeat(64), hash_algo_version: 1, head_sha: headSha }),
    ]);

    const { rows: stateRows } = await pg.ownerPool.query(`SELECT governed_warnings FROM "project_code_state" WHERE project_id = $1`, [project.id]);
    expect(stateRows[0].governed_warnings).toEqual([{ blueprintId: 'SDD-002', message: 'no files matched impacts_paths' }]);

    await app.close();
  });

  test('a preview report never writes to project_code_refs (WO-333)', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    const headSha = 'b'.repeat(40);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'refs-preview' },
      payload: baseReport(headSha, { governed: [{ blueprintId: 'SDD-001', refs: [{ key: 'src/foo.ts', path: 'src/foo.ts', symbol: null, hash: 'b'.repeat(64) }] }] }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('preview');

    const { rows } = await pg.ownerPool.query(`SELECT 1 FROM "project_code_refs" WHERE project_id = $1`, [project.id]);
    expect(rows).toHaveLength(0);

    await app.close();
  });

  test('retrying the same Idempotency-Key never duplicates or corrupts project_code_refs (WO-333)', async () => {
    const app = buildApp();
    const { project, secret } = await setupProject(app);
    const headSha = 'a'.repeat(40);
    const oidcToken = await signOidcToken({}, headSha);
    const payload = baseReport(headSha, { governed: [{ blueprintId: 'SDD-001', refs: [{ key: 'src/foo.ts', path: 'src/foo.ts', symbol: null, hash: 'b'.repeat(64) }] }] });

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'refs-retry', 'x-prdm-github-oidc-token': oidcToken },
      payload,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/code-reports`,
      headers: { authorization: `Bearer ${secret}`, 'idempotency-key': 'refs-retry', 'x-prdm-github-oidc-token': oidcToken },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());

    const { rows } = await pg.ownerPool.query(`SELECT ref_key FROM "project_code_refs" WHERE project_id = $1`, [project.id]);
    expect(rows).toEqual([{ ref_key: 'src/foo.ts' }]);

    await app.close();
  });
});
