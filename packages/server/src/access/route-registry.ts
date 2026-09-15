/**
 * Route access registry (SDD-006 §Permisos, WO-110): an `onRoute` hook that throws the moment a route
 * without `config.access` is registered — a missing declaration is a programmer error caught at server
 * boot, not a silently-unprotected endpoint discovered in production. Must be installed on `app` before
 * any route is added (an `onRoute` hook only ever sees routes registered *after* it, same as any other
 * Fastify hook) — `build-server.ts` calls {@link installRouteAccessRegistry} immediately after
 * `Fastify(...)`, before `registerSecurityHeaders`/`registerHealthRoute`/anything else.
 *
 * Every declared route is also recorded into the registry array this returns — the same list WO-111's
 * isolation suite walks to invoke every registered route with cross-tenant credentials, so there is
 * exactly one place a route becomes "known" to both this hook and that suite.
 */
import type { FastifyInstance, RouteOptions } from 'fastify';
import type { RouteAccess } from './route-access.js';

export interface RegisteredRoute {
  method: string;
  /** Fastify's own route path pattern (e.g. `/api/app/organizations/:orgSlug/projects/:projectSlug`),
   * never a resolved URL — WO-111 substitutes its own fixture ids into the `:param` placeholders. */
  path: string;
  access: RouteAccess;
}

export interface RouteRegistry {
  /** Populated incrementally as routes are registered; safe to read at any point after `app.ready()`. */
  routes: RegisteredRoute[];
}

function methodsOf(routeOptions: RouteOptions): string[] {
  return Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
}

/**
 * Installs the `onRoute` hook and returns the registry it populates. Throws synchronously, at the
 * moment a route missing `config.access` is registered, with a message naming the exact method+path so
 * the failure points straight at the offending `app.get(...)`/`app.post(...)` call.
 */
export function installRouteAccessRegistry(app: FastifyInstance): RouteRegistry {
  const registry: RouteRegistry = { routes: [] };

  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    const access = routeOptions.config?.access;
    if (!access) {
      throw new Error(
        `route ${methodsOf(routeOptions).join(',')} ${routeOptions.url} is missing config.access ` +
          `(SDD-006 §Permisos / WO-110: every route must declare { public: true } or { kind: 'session' | 'bearer', ... })`,
      );
    }
    for (const method of methodsOf(routeOptions)) {
      // Fastify auto-registers a `HEAD` mirror of every `GET` route (`exposeHeadRoutes`, on by
      // default) firing this same hook again with the identical `config.access` inherited from the
      // `GET` — recorded once already, so skip the duplicate rather than making every route table
      // (and WO-111's isolation suite) carry a redundant HEAD entry next to every GET one.
      if (method === 'HEAD') continue;
      registry.routes.push({ method, path: routeOptions.url, access });
    }
  });

  return registry;
}
