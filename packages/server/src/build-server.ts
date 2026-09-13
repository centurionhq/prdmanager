import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerHealthRoute } from './api/health.js';
import { setErrorHandler, setNotFoundHandler } from './errors.js';
import type { ServerEnv } from './env.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: ServerEnv;
    clock: () => Date;
  }
}

export interface BuildServerDeps {
  env: ServerEnv;
  /** Forwarded to Fastify's own `logger` option as-is; defaults to `true` (Fastify's default pino logger). */
  logger?: FastifyServerOptions['logger'];
  /** Injected so anything built on top of this server (audit log, tokens, sessions) never calls `new Date()` directly. */
  clock?: () => Date;
}

/**
 * Fastify factory with no `process`/`env`/`listen` (SDD-006 §Arquitectura): every dependency is passed in
 * so tests can `app.inject()` against it directly. This slice (WO-088) wires only `env`, `logger` and
 * `clock` — `db`, `graph`, `mailer`, `llm` and `oidc` land with the SDD-006 tasks that need them.
 */
export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const { env, logger = true, clock = () => new Date() } = deps;
  const app = Fastify({ logger });

  app.decorate('env', env);
  app.decorate('clock', clock);

  registerHealthRoute(app);

  setErrorHandler(app);
  setNotFoundHandler(app);

  return app;
}
