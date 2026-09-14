import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { registerHealthRoute } from './api/health.js';
import { buildAuth, type Auth } from './auth/build-auth.js';
import { registerAuth } from './auth/register-auth.js';
import { setErrorHandler, setNotFoundHandler } from './errors.js';
import type { ServerEnv } from './env.js';
import { resolveLoggerOption } from './logging.js';
import type { Mailer } from './mailer.js';

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
}

/**
 * Fastify factory with no `process`/`env`/`listen` (SDD-006 §Arquitectura): every dependency is passed in
 * so tests can `app.inject()` against it directly. This slice (WO-088/WO-091/WO-093) wires `env`, a
 * secret-redacting `logger`, `clock` and (when `pool`+`mailer` are given) better-auth mounted behind
 * its allowlist on `/api/auth/*` — `graph`, `llm` and `oidc` land with the SDD-006 tasks that need them.
 */
export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const { env, logger = true, clock = () => new Date(), pool, mailer } = deps;
  const app = Fastify({ logger: resolveLoggerOption(logger) });

  app.decorate('env', env);
  app.decorate('clock', clock);

  registerHealthRoute(app);

  if (pool && mailer) {
    const auth = buildAuth({ env, pool, mailer, clock });
    app.decorate('auth', auth);
    registerAuth(app, { auth, env });
  }

  setErrorHandler(app);
  setNotFoundHandler(app);

  return app;
}
