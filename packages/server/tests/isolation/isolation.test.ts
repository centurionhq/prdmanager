/**
 * WO-111 — the isolation suite harness (SDD-006 §Aislamiento por capas point 4): walks every route
 * `packages/server` registers (via `app.routeAccessRegistry`, WO-110) plus every better-auth allowlisted
 * endpoint, invoking each with org-B credentials against org A's ids and, for project-scoped routes,
 * with a same-org-A caller who has no `project_members` row in project A1 — asserting **404** (never
 * 403: an existence probe never gets to learn a resource exists) and that the fixtures' canary string
 * never appears in any response body or header.
 *
 * Coverage is enforced, not just exercised: a route present in `app.routeAccessRegistry.routes` with no
 * matching entry in `./registry.js` fails a dedicated test below, so a newly added route without a
 * reviewed probe (or an explicit, reasoned `skip`) breaks the suite instead of silently passing.
 */
import { AUTH_ALLOWED_PATHS } from '../../src/auth/allowlist.js';
import { openTestPg, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { registerBaseIsolationRoutes } from './base-routes.js';
import { registerCollabIsolationProbes } from './collab-route.js';
import { buildIsolationFixtures, ISOLATION_AUTH_HOST, ISOLATION_TEST_ENV } from './fixtures.js';
import { getIsolationProbe } from './registry.js';
import { assertNoCanaryLeak, runIsolationProbe, type IsolationHttpMethod } from './run-probe.js';
import type { BuiltApp, IsolationFixtures } from './types.js';

registerBaseIsolationRoutes();
registerCollabIsolationProbes();

describe('isolation suite (SDD-006 §Aislamiento por capas, WO-111)', () => {
  let pg: PgTestDb;
  let app: BuiltApp;
  let fixtures: IsolationFixtures;
  let governedRoutes: { method: string; path: string }[];

  beforeAll(async () => {
    pg = await openTestPg();
    app = buildServer({ env: ISOLATION_TEST_ENV, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    await app.ready();
    fixtures = await buildIsolationFixtures(app, pg);
    governedRoutes = app.routeAccessRegistry.routes.filter((route) => !('public' in route.access));
  });

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  test('every session/bearer route registered on the server has an isolation probe table entry', () => {
    const missing = governedRoutes.filter((route) => !getIsolationProbe(route.method, route.path));
    expect(missing).toEqual([]);
  });

  test('every table entry either documents a skip reason or supplies at least one probe', () => {
    for (const route of governedRoutes) {
      const config = getIsolationProbe(route.method, route.path);
      if (!config) continue; // reported by the coverage test above already
      const hasProbe = Boolean(config.crossOrg || config.sameOrgOtherProject);
      expect(hasProbe || Boolean(config.skip), `${route.method} ${route.path} has neither a probe nor a skip reason`).toBe(true);
    }
  });

  test('runs every registered crossOrg / sameOrgOtherProject probe: expects 404 and no canary leak', async () => {
    const failures: string[] = [];

    for (const route of governedRoutes) {
      const config = getIsolationProbe(route.method, route.path);
      if (!config || config.skip) continue;

      for (const [probeName, factory] of [
        ['crossOrg', config.crossOrg],
        ['sameOrgOtherProject', config.sameOrgOtherProject],
      ] as const) {
        if (!factory) continue;
        const probeCase = factory(fixtures);
        const response = await runIsolationProbe(app, route.method as IsolationHttpMethod, route.path, Boolean(config.mutating), probeCase);

        const label = `${route.method} ${route.path} [${probeName}]`;
        if (response.statusCode !== 404) {
          failures.push(`${label}: expected 404, got ${response.statusCode} (body: ${response.body.slice(0, 200)})`);
          continue;
        }
        try {
          assertNoCanaryLeak(response, fixtures.canary);
        } catch (err) {
          failures.push(`${label}: ${(err as Error).message}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test('every better-auth allowlisted endpoint never leaks the org A canary to an unrelated org B session', async () => {
    const failures: string[] = [];

    for (const path of AUTH_ALLOWED_PATHS) {
      const method = path.includes('get-session') || path.includes('list-sessions') ? 'GET' : 'POST';
      const res = await app.inject({
        method,
        url: `/api/auth${path}`,
        headers: { ...ISOLATION_AUTH_HOST, cookie: fixtures.orgBOwnerSessionCookie },
        payload: method === 'POST' ? {} : undefined,
      });
      if (res.body.includes(fixtures.canary)) {
        failures.push(`/api/auth${path}: canary leaked into response body`);
      }
    }

    expect(failures).toEqual([]);
  });
});
