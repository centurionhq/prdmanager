/**
 * CSRF protection for `/api/app/*` (SDD-006 §Cabeceras, CSRF y logs, WO-108): `@fastify/csrf-protection`
 * double-submit, backed by `@fastify/cookie` — the secret lives in an httpOnly, `SameSite=Lax` cookie the
 * browser attaches automatically, while the derived token is only ever handed to a same-origin caller
 * through `GET /api/app/csrf-token`'s JSON body (SDD-006: "issue token via a GET endpoint") and must be
 * echoed back on every mutating request via the `x-csrf-token` header — a cross-site page can't read that
 * response body (no-cors fetch responses are opaque) even if it can trigger the request itself, so it can
 * never learn the token to replay.
 *
 * better-auth's own `/api/auth/*` surface keeps its own origin check (its `trustedOrigins` option,
 * SDD-006 §Autenticación) and is never routed through this module.
 */
import fastifyCookie from '@fastify/cookie';
import fastifyCsrfProtection from '@fastify/csrf-protection';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerEnv } from '../env.js';
import { ForbiddenError } from '../errors.js';
import { isTrustedRequestOrigin } from './origin-check.js';

const CSRF_COOKIE_KEY = '_csrf';
const CSRF_HEADER = 'x-csrf-token';
const APP_PREFIX = '/api/app';
export const CSRF_TOKEN_ROUTE = '/api/app/csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getCsrfTokenFromRequest(req: FastifyRequest): string | undefined {
  const header = req.headers[CSRF_HEADER];
  return typeof header === 'string' ? header : undefined;
}

function isMutatingAppRequest(req: FastifyRequest): boolean {
  const pathname = req.url.split('?')[0] ?? req.url;
  return pathname.startsWith(APP_PREFIX) && MUTATING_METHODS.has(req.method);
}

/**
 * Registers `@fastify/cookie` + `@fastify/csrf-protection` on `app` (not awaited — same
 * fire-and-register-then-`app.after` pattern `build-server.ts` already uses for `@fastify/rate-limit`,
 * since `buildServer` itself is synchronous and both plugins decorate `app`/`reply` via `fastify-plugin`,
 * so the decorations exist as soon as Fastify's own boot sequence reaches `app.after`/`ready`).
 */
export function registerCsrfPlugins(app: FastifyInstance, env: ServerEnv): void {
  void app.register(fastifyCookie);
  void app.register(fastifyCsrfProtection, {
    cookieKey: CSRF_COOKIE_KEY,
    cookieOpts: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production',
    },
    getToken: getCsrfTokenFromRequest,
  });
}

/**
 * Registers the token-issuance route and the global `onRequest` hook that gates every mutating
 * `/api/app/*` request on both the Origin/Sec-Fetch-Site check and the CSRF token. Must run inside the
 * same `app.after` callback `build-server.ts` uses to sequence every other route registration —
 * `app.csrfProtection`/`reply.generateCsrf` (decorated by {@link registerCsrfPlugins}) are only
 * guaranteed to exist by then.
 */
export function registerCsrfEnforcement(app: FastifyInstance, env: ServerEnv): void {
  app.get(CSRF_TOKEN_ROUTE, async (_req, reply) => ({ token: reply.generateCsrf() }));

  app.addHook('onRequest', async (req, reply) => {
    if (!isMutatingAppRequest(req)) return;
    if (!isTrustedRequestOrigin(req.headers, env.trustedOrigins)) {
      throw new ForbiddenError('cross-site request blocked');
    }
    // `csrfProtection` is callback-style (`(req, reply, next)`) but runs entirely synchronously (a
    // cookie lookup plus an HMAC comparison) and, on failure, calls `reply.send(csrfError)` itself
    // rather than invoking `next` — verified against Fastify's own documented behavior that sending an
    // Error instance routes through `setErrorHandler` (../errors.js maps `FST_CSRF_*` codes to the
    // shared 403 envelope) exactly like a thrown `HttpError`. The no-op `next` below only ever runs on
    // the success path.
    app.csrfProtection(req, reply, () => {});
  });
}
