import rateLimitPlugin, { type FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { installBearerAccessPreHandler } from './access/bearer-access-prehandler.js';
import { installRouteAccessRegistry, type RouteRegistry } from './access/route-registry.js';
import { registerAdminOrganizationRoutes } from './api/admin-organizations.js';
import { registerCiTokenRoutes } from './api/ci-tokens.js';
import { registerHealthRoute } from './api/health.js';
import { registerInvitationAcceptRoute } from './api/invitation-accept.js';
import { registerOrganizationInvitationRoutes } from './api/organization-invitations.js';
import { registerOrganizationRoutes } from './api/organizations.js';
import { registerProjectRoutes } from './api/projects.js';
import { registerTokenRoutes } from './api/tokens.js';
import { registerV1MeRoute } from './api/v1-me.js';
import { buildAuth, type Auth } from './auth/build-auth.js';
import { registerAuth } from './auth/register-auth.js';
import { registerCsrfEnforcement, registerCsrfPlugins } from './csrf/register-csrf.js';
import { setErrorHandler, setNotFoundHandler } from './errors.js';
import type { ServerEnv } from './env.js';
import { resolveLoggerOption } from './logging.js';
import type { Mailer } from './mailer.js';
import { buildAuthRateLimiters } from './rate-limit/auth-rate-limits.js';
import { buildBearerAuthRateLimiter } from './rate-limit/bearer-rate-limits.js';
import { buildInvitationAcceptRateLimiter } from './rate-limit/invitation-rate-limits.js';
import { registerSecurityHeaders } from './security-headers.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: ServerEnv;
    clock: () => Date;
    auth?: Auth;
    routeAccessRegistry: RouteRegistry;
  }
}

export interface BuildServerDeps {
  env: ServerEnv;
  /** Merged with the mandatory secret-redaction options from `./logging.js` (WO-091) before reaching
   * Fastify's own `logger` option; defaults to `true` (redacted pino logger at `info` level). */
  logger?: FastifyServerOptions['logger'];
  /** Injected so anything built on top of this server (audit log, tokens, sessions) never calls `new Date()` directly. */
  clock?: () => Date;
  /** `prdm_app` pool (SDD-006 §Aislamiento) better-auth's drizzle adapter reads/writes through.
   * Building a `Pool` never opens a socket (`packages/db/src/pool.ts`), so tests that don't exercise
   * `/api/auth/*` can pass one freely. Required together with `mailer` to mount better-auth (WO-093);
   * omitted, `/api/auth/*` simply 404s like any other unmatched route. */
  pool?: Pool;
  mailer?: Mailer;
  /** Test-only: a `@fastify/rate-limit` store backed by a fake clock (`./rate-limit/clock-store.js`)
   * so rate-limit window tests never `sleep`. Production leaves this unset (real wall-clock `LocalStore`). */
  rateLimitStore?: FastifyRateLimitStoreCtor;
  /** `packages/app`'s built bundle (`dist/`), or a temp dir in tests; static serving — and the SPA fallback in
   * `setNotFoundHandler` — is skipped entirely when omitted (SDD-006 "Local y despliegue"). */
  staticDir?: string;
}

/**
 * Fastify factory with no `process`/`env`/`listen` (SDD-006 §Arquitectura): every dependency is passed in
 * so tests can `app.inject()` against it directly. This slice (WO-088/WO-091/WO-093) wires `env`, a
 * secret-redacting `logger`, `clock` and (when `pool`+`mailer` are given) better-auth mounted behind
 * its allowlist on `/api/auth/*` — `graph`, `llm` and `oidc` land with the SDD-006 tasks that need them.
 */
export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const { env, logger = true, clock = () => new Date(), pool, mailer, rateLimitStore, staticDir } = deps;
  // Fastify only derives `request.ip`/`request.hostname` from X-Forwarded-* headers when this is
  // set (SDD-006 §Autenticación): same PRDM_TRUST_PROXY gate as the /api/auth/* Host guard and,
  // later, @fastify/rate-limit's IP source (WO-095) — one flag, one trust decision, everywhere.
  const app = Fastify({ logger: resolveLoggerOption(logger), trustProxy: env.trustProxy });

  app.decorate('env', env);
  app.decorate('clock', clock);

  // Installed before any route is registered (WO-110): `onRoute` only ever sees routes added *after*
  // it, so every single route on this instance — health check, /api/auth/* passthrough, every
  // /api/app/* and /api/v1/* route alike — must declare `config.access` or registration itself throws.
  app.decorate('routeAccessRegistry', installRouteAccessRegistry(app));

  // Unconditional (not gated behind `pool && mailer`): every response — health check, a bare 404,
  // /api/app/* alike — carries these (SDD-006 §Cabeceras).
  registerSecurityHeaders(app, env);

  registerHealthRoute(app);

  if (staticDir) {
    // `serve: false`: this plugin would otherwise auto-register its own route(s) (a single `GET /*` by default,
    // or one route per file under `wildcard: false`) with no `config.access`, which `installRouteAccessRegistry`
    // above throws on for *every* route regardless of who registers it. `serve: false` skips all of that route
    // registration while still decorating `reply.sendFile()` (`decorateReply` defaults to `true` independently of
    // `serve` — verified against the plugin's own source), so the single explicit wildcard route below — public,
    // since the built SPA bundle carries no secrets — is the only route this registration ever adds.
    void app.register(fastifyStatic, { root: staticDir, serve: false });
    // Deliberately not `async`: `reply.sendFile()` doesn't return the promise it kicks off internally, so an
    // `async` handler here would resolve (with `undefined`) before the file is actually streamed — Fastify then
    // finalizes the response itself, racing the real one (verified empirically: an `async` version of this
    // handler sent an empty 200 body every time). A plain sync handler keeps the reply open until
    // `reply.send()` fires further down inside `sendFile`, exactly like `@fastify/static`'s own README example
    // and this same package's `setNotFoundHandler` below.
    app.get('/*', { config: { access: { public: true } } }, (request, reply) => {
      const rawUrl = request.raw.url ?? '/';
      const questionMark = rawUrl.indexOf('?');
      const rawPathname = questionMark === -1 ? rawUrl : rawUrl.slice(0, questionMark);
      let pathname: string;
      try {
        // `decodeURI` (not Fastify's own `request.params['*']`, which fully `decodeURIComponent`s): it
        // deliberately leaves `%2f`/`%5c` encoded, matching `@fastify/static`'s own `getPathnameForSend`. The
        // traversal guards inside `reply.sendFile` only recognize a `..` segment bounded by a *real* `/` — fully
        // decoding `%2f` to `/` first would let `/assets/..%2f..%2f../etc/passwd` slip right past them
        // (verified empirically: an earlier version of this handler used `request.params['*']` for exactly that
        // reason and leaked a 500 instead of falling through to the SPA shell).
        pathname = decodeURI(rawPathname);
      } catch {
        void reply.code(400).send();
        return;
      }
      void reply.sendFile(pathname === '/' ? '/index.html' : pathname);
    });
  }

  if (pool && mailer) {
    const auth = buildAuth({ env, pool, mailer, clock });
    app.decorate('auth', auth);
    // `global: false`: no route is rate-limited unless it opts in explicitly (register-auth.ts does,
    // per-path, via the exported keyed helper) — this plugin only ever supplies `app.createRateLimit`.
    void app.register(rateLimitPlugin, { global: false, store: rateLimitStore });
    // CSRF (WO-108): both plugins decorate `app`/`reply` via `fastify-plugin`, so registering them here
    // (unawaited, like the rate-limit plugin above) is enough for `app.after` below to see the
    // decorations.
    registerCsrfPlugins(app, env);
    // `app.createRateLimit`/`app.csrfProtection`/`reply.generateCsrf` only exist once the plugins above
    // have finished registering; `app.after` defers everything that depends on them (every /api/app/*
    // and /api/auth/* route) until that's guaranteed.
    app.after((err) => {
      if (err) throw err;
      // WO-110: one global preHandler enforces every `{ kind: 'bearer', scope }` route's scope (and the
      // SDD-006 §Permisos token-kind table) — individual Bearer route handlers never call
      // `requireBearerToken` themselves.
      installBearerAccessPreHandler(app, { pool, clock, rateLimiter: buildBearerAuthRateLimiter(app) });
      const rateLimiters = buildAuthRateLimiters(app);
      registerAuth(app, { auth, env, rateLimiters });
      registerCsrfEnforcement(app, env);
      registerOrganizationRoutes(app, { auth, pool, env });
      registerAdminOrganizationRoutes(app, { auth, pool, mailer, env });
      registerOrganizationInvitationRoutes(app, { auth, pool, mailer, env });
      registerProjectRoutes(app, { auth, pool, env });
      registerInvitationAcceptRoute(app, { auth, pool, env, rateLimiter: buildInvitationAcceptRateLimiter(app) });
      registerTokenRoutes(app, { auth, pool, env, clock });
      registerCiTokenRoutes(app, { auth, pool, env, clock });
      registerV1MeRoute(app, { pool });
    });
  }

  setErrorHandler(app);
  setNotFoundHandler(app, { hasStatic: Boolean(staticDir) });

  return app;
}
