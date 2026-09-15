/**
 * WO-110 — the global Bearer preHandler: a table-driven matrix of (token kind × requested scope ×
 * granted scopes) against a synthetic `/api/v1/test/*` route family, registered directly on the real
 * `buildServer()` instance (same registry, same preHandler, same rate limiter as every real `/api/v1/*`
 * route) so this exercises production wiring, not a reimplementation of it.
 *
 * 403 vs 404 policy (documented here since this is where it's enforced): a request with a *valid*
 * token that simply lacks the required scope, or whose kind can never hold that scope at all
 * (SDD-006 §Permisos table), gets **403** — the caller already proved who they are, they're just not
 * allowed to do this. A request whose scope check *passes* but whose token is scoped to a different
 * project/org than the one named in the URL gets **404** from the route handler itself (never 403),
 * exactly like a session route's cross-tenant resource — existence is never confirmed to a caller who
 * isn't already authorized to know about it.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { NotFoundError } from '../../src/errors.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('Bearer scope enforcement matrix (WO-110)', () => {
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

  /** Registers the synthetic scope-matrix and project-visibility routes used only by this test file,
   * on top of the real server (same preHandler/registry every production `/api/v1/*` route uses). */
  function withSyntheticRoutes(app: FastifyInstance): FastifyInstance {
    app.get(
      '/api/v1/test/governance-read',
      { config: { access: { kind: 'bearer', scope: 'governance:read' } } },
      async (req) => ({ tokenId: req.token!.tokenId }),
    );
    app.get(
      '/api/v1/test/reports-baseline',
      { config: { access: { kind: 'bearer', scope: 'reports:baseline' } } },
      async (req) => ({ tokenId: req.token!.tokenId }),
    );
    app.get(
      '/api/v1/test/import-write',
      { config: { access: { kind: 'bearer', scope: 'import:write' } } },
      async (req) => ({ tokenId: req.token!.tokenId }),
    );
    app.get<{ Params: { projectId: string } }>(
      '/api/v1/test/projects/:projectId/report',
      { config: { access: { kind: 'bearer', scope: 'reports:write' } } },
      async (req) => {
        // Scope already checked by the preHandler; this is the resource-ownership check the route
        // itself is responsible for — a project the token isn't scoped to 404s, never 403.
        const token = req.token!;
        if (token.projectIds && !token.projectIds.includes(req.params.projectId)) throw new NotFoundError();
        return { ok: true };
      },
    );
    return app;
  }

  async function signIn(app: FastifyInstance, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function issuePersonalToken(app: FastifyInstance, cookie: string, orgSlug: string, scopes: string[]): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { orgSlug, name: 'matrix', scopes, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    return res.json().secret;
  }

  async function issueCiToken(app: FastifyInstance, cookie: string, orgSlug: string, projectSlug: string, scopes: string[]): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${orgSlug}/projects/${projectSlug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name: 'ci-matrix', scopes, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    return res.json().secret;
  }

  test.each([
    { kind: 'personal', route: '/api/v1/test/governance-read', grantedScopes: ['governance:read'], expectedStatus: 200 },
    { kind: 'personal', route: '/api/v1/test/import-write', grantedScopes: ['import:write'], expectedStatus: 200 },
    { kind: 'personal', route: '/api/v1/test/governance-read', grantedScopes: ['mcp:read'], expectedStatus: 403 },
    { kind: 'personal', route: '/api/v1/test/reports-baseline', grantedScopes: ['governance:read'], expectedStatus: 403 },
    { kind: 'ci', route: '/api/v1/test/governance-read', grantedScopes: ['governance:read'], expectedStatus: 200 },
    { kind: 'ci', route: '/api/v1/test/reports-baseline', grantedScopes: ['reports:baseline'], expectedStatus: 200 },
    { kind: 'ci', route: '/api/v1/test/import-write', grantedScopes: ['governance:read', 'reports:write'], expectedStatus: 403 },
    { kind: 'ci', route: '/api/v1/test/governance-read', grantedScopes: ['reports:write'], expectedStatus: 403 },
  ] as const)('$kind token, granted $grantedScopes, calling $route -> $expectedStatus', async ({ kind, route, grantedScopes, expectedStatus }) => {
    const app = withSyntheticRoutes(buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false }));
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const cookie = await signIn(app, owner.email);

    let secret: string;
    if (kind === 'personal') {
      secret = await issuePersonalToken(app, cookie, org.slug, [...grantedScopes]);
    } else {
      const project = await createProjectFixture(pg, { orgId: org.id });
      secret = await issueCiToken(app, cookie, org.slug, project.slug, [...grantedScopes]);
    }

    const res = await app.inject({ method: 'GET', url: route, headers: { authorization: `Bearer ${secret}` } });
    expect(res.statusCode).toBe(expectedStatus);

    await app.close();
  });

  test('a CI token scoped to project A gets 404 (never 403) on a report route for project B in the same org', async () => {
    const app = withSyntheticRoutes(buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false }));
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const projectA = await createProjectFixture(pg, { orgId: org.id });
    const projectB = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    const secret = await issueCiToken(app, cookie, org.slug, projectA.slug, ['reports:write']);

    const ownProject = await app.inject({
      method: 'GET',
      url: `/api/v1/test/projects/${projectA.id}/report`,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(ownProject.statusCode).toBe(200);

    const otherProject = await app.inject({
      method: 'GET',
      url: `/api/v1/test/projects/${projectB.id}/report`,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(otherProject.statusCode).toBe(404);

    await app.close();
  });

  test('an insufficient-scope request on the same route is 403, not 404', async () => {
    const app = withSyntheticRoutes(buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false }));
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    const secret = await issueCiToken(app, cookie, org.slug, project.slug, ['governance:read']);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/test/projects/${project.id}/report`,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });
});
