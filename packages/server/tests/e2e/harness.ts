/**
 * WO-201 (SDD-010 §Tests, "E2E Playwright del recorrido completo"): boots a *real* `buildServer()`
 * instance — real Postgres (via `@prdm/testkit`'s `openTestPg`, same as every integration test), real
 * Neo4j, a real listening HTTP port, and the actual built `@prdm/app` SPA as `staticDir` — with a
 * `FakeLlmClient` (never a real DeepSeek call, per SDD-010's own "Tests" section) and a test GitHub OIDC
 * JWKS (WO-179's test-JWKS injection pattern — never a real GitHub token exchange), so the Playwright spec
 * in this same directory can drive the whole product through a real browser plus a real
 * `StreamableHTTPClientTransport` MCP client.
 *
 * Deliberately listens on a fixed, non-default port (never 4601 — a manually-running demo server may
 * already be using it) rather than `port: 0`: `env.publicUrl`/`trustedOrigins` must be known *before*
 * `buildServer` is constructed (better-auth's cookie/CSRF settings derive from `publicUrl`), so the port
 * can't be discovered only after `listen()` resolves the way plain fastify-only tests do.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { Neo4jGraphDatabase } from '@prdm/core';
import { assertDbAllowed, createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, type PgTestDb } from '@prdm/testkit';
import { buildServer } from '../../src/build-server.js';
import { createFakeLlmClient, type FakeLlmClient } from '../../src/agent/fake-llm-client.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser, type SeededUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

/** Fixed (never OS-assigned) and distinct from the demo server's own 4601 — see this module's own doc
 * comment above. */
export const E2E_PORT = 4655;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const PASSWORD = 'correct-horse-battery-staple';
export const DEFAULT_BRANCH = 'main';
const REPO_ID = '900000111';
const OWNER_ID = '900000222';
const OIDC_KID = 'e2e-test-key';

const APP_DIST = fileURLToPath(new URL('../../../app/dist', import.meta.url));

export interface JourneyOrg {
  id: string;
  slug: string;
}

export interface JourneyProject {
  id: string;
  slug: string;
  graphProjectId: string;
}

export interface Journey {
  app: Awaited<ReturnType<typeof buildServer>>;
  pg: PgTestDb;
  neo4j: Neo4jGraphDatabase;
  tmpRoot: string;
  baseUrl: string;
  org: JourneyOrg;
  project: JourneyProject;
  alice: SeededUser;
  bob: SeededUser;
  /** `project_ci` token: `governance:read` (to read the current `graph_version` before reporting, same
   * as a real `prdm sync`), `reports:write` and `reports:baseline`. */
  ciTokenSecret: string;
  /** `personal` token: `mcp:read`/`mcp:write`, used by the `StreamableHTTPClientTransport` client. */
  mcpTokenSecret: string;
  jwks: JWTVerifyGetKey;
  oidcPrivateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
}

async function signInForm(app: Journey['app'], env: ReturnType<typeof buildTestServerEnv>, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: { host: new URL(env.publicUrl).host } });
  const cookie = res.headers['set-cookie'];
  const raw = Array.isArray(cookie) ? cookie[0] : cookie;
  if (!raw) throw new Error('sign-in did not set a session cookie');
  return raw.split(';')[0]!;
}

export async function startJourney(): Promise<Journey> {
  // This harness calls `Neo4jGraphDatabase.connect` directly (it needs the raw driver for `buildServer`,
  // not `openTestDb`'s `GraphStore`), so it can't rely on `openTestPg`'s own internal guard alone —
  // see `assertDbAllowed`'s own doc comment in `@prdm/testkit`.
  assertDbAllowed();
  if (!existsSync(APP_DIST)) {
    throw new Error(`@prdm/app bundle not found at ${APP_DIST}; run "npm run build --workspace=@prdm/app" first`);
  }

  const pg = await openTestPg();
  const tmpRoot = makeTmpDir();
  const config = testConfig(tmpRoot);
  const neo4j = Neo4jGraphDatabase.connect(config.neo4j);
  await neo4j.verify();
  await neo4j.migrate();

  const env = buildTestServerEnv({
    neo4j: config.neo4j,
    publicUrl: E2E_BASE_URL,
    trustedOrigins: [E2E_BASE_URL],
    // WO-152's real per-second update-rate limits (`buildTestServerEnv`'s own defaults: 30/user,
    // 100/document) assume a human typing — Playwright's `keyboard.type()` sends every keystroke as its
    // own Yjs update with no inter-key delay, which blew straight through the real default limits while
    // this E2E was being written (the server closes the *connection* once a limit is exceeded, WO-152's
    // own doc comment — reconnecting afterward is exactly what made the flakiness intermittent rather
    // than a hard, obvious failure). Raised generously here, for this end-to-end journey only; the real
    // limits themselves are already covered by `packages/server/tests/collab/limits.test.ts`.
    collabLimits: {
      maxRenderedBytes: 512 * 1024,
      maxEncodedStateBytes: 20 * 1024 * 1024,
      maxConnectionsPerUser: 50,
      maxConnectionsPerDocument: 50,
      maxUpdatesPerSecPerUser: 1000,
      maxUpdatesPerSecPerDocument: 1000,
    },
  });

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: OIDC_KID, alg: 'RS256' }] });

  const llmClient: FakeLlmClient = createFakeLlmClient([
    [
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_1',
          name: 'propose_edit',
          argumentsJson: JSON.stringify({
            summary: 'sharpen the shared vision statement',
            edits: [{ expectedText: 'ship real-time collaboration', replacement: 'ship real-time collaborative editing' }],
          }),
        },
      },
      { type: 'done', finishReason: 'tool_calls' },
    ],
    [{ type: 'token', text: 'Proposed a small wording improvement for your review.' }, { type: 'done', finishReason: 'stop' }],
  ]);

  // `E2E_DEBUG=1` opts into real request logging for local troubleshooting only — off by default (and
  // always off in CI) to keep a passing run's output as quiet as every other test suite's.
  // `collabPersistDebounce` deliberately left at Hocuspocus's own real default (never `{debounce: 0,
  // maxDebounce: 0}`, tempting as that looked for a quieter teardown): forcing every single keystroke to
  // synchronously store-and-rescan (`PgProjectEngine.scan()`, live validation) turned out to create far
  // more Postgres contention than a `page.keyboard.type()` burst without it — WO-149's own batching
  // window existing for exactly this reason. A `Cannot use a pool after calling end on the pool` line
  // from a debounced store still in flight when `stopJourney` closes the pool is caught and merely
  // logged by Hocuspocus itself (this file's own harmless, already-documented teardown-ordering noise),
  // never a failure this test's own assertions ever see.
  const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: Boolean(process.env.E2E_DEBUG), neo4j, llmClient, githubOidcJwks: jwks, staticDir: APP_DIST });
  await app.ready();
  await app.listen({ port: E2E_PORT, host: '127.0.0.1' });

  const alice = await seedUser(env, pg.appPool, PASSWORD);
  const bob = await seedUser(env, pg.appPool, PASSWORD);
  const orgFixture = await createOrganizationFixture(pg);
  await createMemberFixture(pg, { organizationId: orgFixture.id, userId: alice.id, role: 'owner' });
  await createMemberFixture(pg, { organizationId: orgFixture.id, userId: bob.id, role: 'member' });
  const projectFixture = await createProjectFixture(pg, { orgId: orgFixture.id });
  await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'editor')`, [projectFixture.id, bob.id, orgFixture.id]);
  await pg.ownerPool.query(`UPDATE "projects" SET settings = $1 WHERE id = $2`, [
    JSON.stringify({
      default_branch: DEFAULT_BRANCH,
      github_repository: 'acme/widgets',
      github_repository_id: Number(REPO_ID),
      github_owner_id: Number(OWNER_ID),
      hash_algo_version: 1,
    }),
    projectFixture.id,
  ]);
  const store = neo4j.forProject({ id: projectFixture.graphProjectId, name: projectFixture.name, root: `saas://project/${projectFixture.id}` });
  await store.clear();

  const aliceCookie = await signInForm(app, env, alice.email);
  const dayMs = 24 * 60 * 60 * 1000;
  const ciTokenRes = await app.inject({
    method: 'POST',
    url: `/api/app/organizations/${orgFixture.slug}/projects/${projectFixture.slug}/ci-tokens`,
    headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, aliceCookie),
    payload: { name: 'e2e-ci', scopes: ['governance:read', 'reports:write', 'reports:baseline'], expiresAt: new Date(Date.now() + dayMs).toISOString() },
  });
  if (ciTokenRes.statusCode !== 200) throw new Error(`failed to create CI token: ${ciTokenRes.statusCode} ${ciTokenRes.payload}`);
  const ciTokenSecret = ciTokenRes.json().secret as string;

  const mcpTokenRes = await app.inject({
    method: 'POST',
    url: '/api/app/tokens',
    headers: await mutationHeaders(app, { host: new URL(env.publicUrl).host }, env.publicUrl, aliceCookie),
    payload: { orgSlug: orgFixture.slug, name: 'e2e-mcp', scopes: ['mcp:read', 'mcp:write'], expiresAt: new Date(Date.now() + dayMs).toISOString() },
  });
  if (mcpTokenRes.statusCode !== 200) throw new Error(`failed to create MCP token: ${mcpTokenRes.statusCode} ${mcpTokenRes.payload}`);
  const mcpTokenSecret = mcpTokenRes.json().secret as string;

  return {
    app,
    pg,
    neo4j,
    tmpRoot,
    baseUrl: E2E_BASE_URL,
    org: { id: orgFixture.id, slug: orgFixture.slug },
    project: { id: projectFixture.id, slug: projectFixture.slug, graphProjectId: projectFixture.graphProjectId },
    alice,
    bob,
    ciTokenSecret,
    mcpTokenSecret,
    jwks,
    oidcPrivateKey: privateKey,
  };
}

export async function stopJourney(journey: Journey): Promise<void> {
  await journey.app.close();
  await journey.neo4j.close();
  removeDir(journey.tmpRoot);
  await journey.pg.close();
}

export function githubOidcClaims(headSha: string): Record<string, unknown> {
  return {
    repository_id: REPO_ID,
    repository_owner_id: OWNER_ID,
    ref: `refs/heads/${DEFAULT_BRANCH}`,
    event_name: 'push',
    sha: headSha,
    jti: `jti-${randomUUID()}`,
  };
}

export const OIDC_KID_EXPORT = OIDC_KID;
