import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Engine, GraphStore, PrdmConfig } from '@prdm/core';
import { registerBranchRoute } from './api/branch.js';
import { registerFullGraphRoute } from './api/full-graph.js';
import { registerHealthRoute } from './api/health.js';
import { registerNodeRoute } from './api/node.js';
import { registerSearchRoute } from './api/search.js';
import { registerTreeRoute } from './api/tree.js';
import { setErrorHandler, setNotFoundHandler } from './errors.js';

/** Matches `PRDM_WEB_PORT`'s own default (SDD-005 "Seguridad"). */
export const DEFAULT_WEB_PORT = 4600;

export interface BuildAppOptions {
  config: PrdmConfig;
  store: GraphStore;
  engine: Engine;
  /** `dist/client`, or a temp dir in tests; static serving is skipped entirely when omitted (WO-056 wires the real bundle). */
  staticDir?: string;
  /**
   * The port this process is (or will be) bound to, purely for the Host-header guard below. Not part of SDD-005's
   * literal `buildApp({config, store, engine, staticDir?})` signature, but the guard needs to know the port to do
   * its job and must be registered before any route so it always runs first — `server.ts` reading `PRDM_WEB_PORT`
   * itself and threading it in here keeps that ordering correct and keeps the guard testable via `app.inject()`
   * without spinning up a real bootstrap. Defaults to `PRDM_WEB_PORT`'s own default.
   */
  port?: number;
}

/**
 * DNS-rebinding guard (SDD-005 "Seguridad"): a page the user visits can resolve any hostname to `127.0.0.1` and
 * `fetch` this port from an origin the browser treats as valid. Binding to loopback is not a security boundary by
 * itself, so every request's `Host` header must be exactly one of these two literal forms — regardless of what
 * `PRDM_WEB_HOST` is configured to (a non-loopback bind is a separate, explicit opt-in gated in `server.ts`).
 */
export function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

/**
 * Fastify factory with no `process`/`env`/`listen` (SDD-005 "Arquitectura"): every dependency is passed in, so
 * tests can `app.inject()` against it directly without a real bootstrap. Never calls `engine.refresh()` or
 * `engine.recover()` — this process is strictly read-only (SDD-005 "Ciclo de vida del Engine").
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { store, staticDir, port = DEFAULT_WEB_PORT } = options;
  const app = Fastify({ logger: true });

  // Runs before anything else, for every request (not just /api/*): SDD-005 "Seguridad".
  app.addHook('onRequest', async (request, reply) => {
    if (!isAllowedHost(request.headers.host, port)) {
      await reply.code(403).send({ error: { code: 'validation_error', message: 'invalid Host header' } });
    }
  });

  // SDD-005 "Contrato HTTP": every /api/* response, success or error, is uncacheable.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  if (staticDir) {
    void app.register(fastifyStatic, { root: staticDir });
  }

  registerHealthRoute(app);
  registerNodeRoute(app, { store });
  registerSearchRoute(app, { store });
  registerBranchRoute(app, { store });
  registerFullGraphRoute(app, { store });
  registerTreeRoute(app, { store });

  // Remaining `/api` route plugins are added here, one per work order, by WO-052 through WO-054.

  setErrorHandler(app);
  setNotFoundHandler(app, { hasStatic: Boolean(staticDir) });

  return app;
}
