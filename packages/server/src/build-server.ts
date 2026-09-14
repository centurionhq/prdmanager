import rateLimitPlugin, { type FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { registerHealthRoute } from './api/health.js';
import { buildAuth, type Auth } from './auth/build-auth.js';
import { registerAuth } from './auth/register-auth.js';
import { setErrorHandler, setNotFoundHandler } from './errors.js';
import type { ServerEnv } from './env.js';
import { resolveLoggerOption } from './logging.js';
import type { Mailer } from './mailer.js';
import { buildAuthRateLimiters } from './rate-limit/auth-rate-limits.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: ServerEnv;
    clock: () => Date;
    auth?: Auth;
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
}

/**
 * Fastify factory with no `process`/`env`/`listen` (SDD-006 §Arquitectura): every dependency is passed in
 * so tests can `app.inject()` against it directly. This slice (WO-088/WO-091/WO-093) wires `env`, a
 * secret-redacting `logger`, `clock` and (when `pool`+`mailer` are given) better-auth mounted behind
 * its allowlist on `/api/auth/*` — `graph`, `llm` and `oidc` land with the SDD-006 tasks that need them.
 */
export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const { env, logger = true, clock = () => new Date(), pool, mailer, rateLimitStore } = deps;
  // Fastify only derives `request.ip`/`request.hostname` from X-Forwarded-* headers when this is
  // set (SDD-006 §Autenticación): same PRDM_TRUST_PROXY gate as the /api/auth/* Host guard and,
  // later, @fastify/rate-limit's IP source (WO-095) — one flag, one trust decision, everywhere.
  const app = Fastify({ logger: resolveLoggerOption(logger), trustProxy: env.trustProxy });

  app.decorate('env', env);
  app.decorate('clock', clock);

  registerHealthRoute(app);

  if (pool && mailer) {
    const auth = buildAuth({ env, pool, mailer, clock });
    app.decorate('auth', auth);
    // `global: false`: no route is rate-limited unless it opts in explicitly (register-auth.ts does,
    // per-path, via the exported keyed helper) — this plugin only ever supplies `app.createRateLimit`.
    void app.register(rateLimitPlugin, { global: false, store: rateLimitStore });
    // `app.createRateLimit` only exists once the plugin above has finished registering; `app.after`
    // defers building the limiters (and therefore mounting /api/auth/*) until that's guaranteed.
    app.after((err) => {
      if (err) throw err;
      const rateLimiters = buildAuthRateLimiters(app);
      registerAuth(app, { auth, env, rateLimiters });
    });
  }

  setErrorHandler(app);
  setNotFoundHandler(app);

  return app;
}
