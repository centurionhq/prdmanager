/**
 * Route access declarations (SDD-006 §Permisos: "toda ruta y tool declara su scope y registrar una sin
 * scope falla", WO-110). Every Fastify route registered anywhere on the server carries one of these in
 * its `config.access` — checked at registration time by `./route-registry.js`, never left to be
 * noticed only once a request hits an underdeclared route in production.
 *
 * - `{ public: true }`: no session, no Bearer token — the route does its own thing (a liveness check,
 *   issuing a CSRF token, resolving an invitation by its own one-time secret, or better-auth's own
 *   internal per-endpoint auth on `/api/auth/*`).
 * - `{ kind: 'session' }`: requires `requireAppSession` (a real `/api/app/*` cookie session); any
 *   finer-grained permission check is the route's own `can(subject, action)` call against
 *   `@prdm/contracts`'s org/project role matrix — this declaration only records *that* the route is
 *   session-gated, for the registry (and WO-111's isolation suite) to enumerate.
 * - `{ kind: 'bearer', scope }`: requires a valid, unexpired, unrevoked API token (WO-109's Bearer
 *   plugin) carrying `scope` among its own granted scopes — or the literal `'any'` sentinel for a route
 *   like `GET /api/v1/me` that only needs *some* valid token, not a particular scope.
 */
import type { TokenScope } from '@prdm/db';

export type { TokenScope };

export type RouteAccess = { public: true } | { kind: 'session' } | { kind: 'bearer'; scope: TokenScope | 'any' };

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
}

export function isPublicAccess(access: RouteAccess): access is { public: true } {
  return 'public' in access && access.public === true;
}

export function isSessionAccess(access: RouteAccess): access is { kind: 'session' } {
  return 'kind' in access && access.kind === 'session';
}

export function isBearerAccess(access: RouteAccess): access is { kind: 'bearer'; scope: TokenScope | 'any' } {
  return 'kind' in access && access.kind === 'bearer';
}
