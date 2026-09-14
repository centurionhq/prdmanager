import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerHealthRoute } from './api/health.js';
import { setErrorHandler, setNotFoundHandler } from './errors.js';
import type { ServerEnv } from './env.js';
import { resolveLoggerOption } from './logging.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: ServerEnv;
    clock: () => Date;
  }
}

export interface BuildServerDeps {
  env: ServerEnv;
  /** Merged with the mandatory secret-redaction options from `./logging.js` (WO-091) before reaching
   * Fastify's own `logger` option; defaults to `true` (redacted pino logger at `info` level). */
  logger?: FastifyServerOptions['logger'];
  /** Injected so anything built on top of this server (audit log, tokens, sessions) never calls `new Date()` directly. */
  clock?: () => Date;
}

/**
 * Fastify factory with no `process`/`env`/`listen` (SDD-006 §Arquitectura): every dependency is passed in
 * so tests can `app.inject()` against it directly. This slice (WO-088/WO-091) wires `env`, a
 * secret-redacting `logger` and `clock` — `db`, `graph`, `mailer`, `llm` and `oidc` land with the
 * SDD-006 tasks that need them (WO-093+).
 */
export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const { env, logger = true, clock = () => new Date() } = deps;
  const app = Fastify({ logger: resolveLoggerOption(logger) });

  app.decorate('env', env);
  app.decorate('clock', clock);

  registerHealthRoute(app);

  setErrorHandler(app);
  setNotFoundHandler(app);

  return app;
}
