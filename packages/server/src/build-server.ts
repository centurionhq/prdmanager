import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import rateLimitPlugin, { type FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Neo4jGraphDatabase } from '@prdm/core';
import { buildPgOidcJtiStore, type OidcJtiStore } from '@prdm/db';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { JWTVerifyGetKey } from 'jose';
import type { Pool } from 'pg';
import { createInMemoryOidcJtiStore, githubOidcRemoteJwks } from './auth/github-oidc.js';
import { injectCspNonce } from './spa-html.js';
import { installBearerAccessPreHandler } from './access/bearer-access-prehandler.js';
import { installRouteAccessRegistry, type RouteRegistry } from './access/route-registry.js';
import { registerAdminOrganizationRoutes } from './api/admin-organizations.js';
import { registerCiTokenRoutes } from './api/ci-tokens.js';
import { registerCodeReportRoutes } from './api/code-reports.js';
import { buildCodeReportRateLimiter } from './rate-limit/code-report-rate-limits.js';
import type { ScannedDocsCache } from './engine/scanned-docs-cache.js';
import { registerHealthRoute } from './api/health.js';
import { registerInvitationAcceptRoute } from './api/invitation-accept.js';
import { registerOrganizationInvitationRoutes } from './api/organization-invitations.js';
import { registerCloseFeatureRoutes } from './api/close-feature.js';
import { registerCollabRoute, registerCollabWebsocketPlugin } from './collab/register-collab-route.js';
import { createCollabRevocationHub, type CollabRevocationHub } from './collab/revocation.js';
import { realCollabScheduler, type CollabScheduler } from './collab/scheduler.js';
import { realCollabBatchScheduler, type CollabBatchScheduler } from './collab/batch-scheduler.js';
import { registerDocumentRoutes } from './api/documents.js';
import { registerDocumentBlameRoute } from './api/documents-blame.js';
import { registerDocumentPublishRoute } from './api/documents-publish.js';
import { registerDocumentVersionRoutes } from './api/documents-versions.js';
import { registerDocumentCommentRoutes } from './api/documents-comments.js';
import { registerDocumentAgentRoutes } from './api/documents-agent.js';
import { createAgentStreamRevocationHub, type AgentStreamRevocationHub } from './agent/agent-stream-revocation.js';
import { buildCommentRateLimiter } from './rate-limit/comment-rate-limits.js';
import { buildAgentRateLimiter } from './rate-limit/agent-rate-limits.js';
import type { LlmClient } from './agent/llm-client.js';
import { createBlameCache } from './collab/blame.js';
import { registerDriftRoutes } from './api/drift.js';
import { registerForcePushOverrideRoutes } from './api/force-push-overrides.js';
import { DEFAULT_MCP_TOOL_RATE_LIMIT_PER_MINUTE, registerMcpRemoteRoutes } from './api/mcp-remote.js';
import { buildMcpToolRateLimiter } from './rate-limit/mcp-tool-rate-limits.js';
import { registerGovernanceRoutes } from './api/governance.js';
import { registerImportRoutes } from './api/import.js';
import { buildImportRateLimiter } from './rate-limit/import-rate-limits.js';
import { registerGraphRoutes } from './api/graph.js';
import { registerLineBoardRoutes } from './api/line-board.js';
import { registerOrganizationRoutes } from './api/organizations.js';
import { registerPolicyDocsRoutes } from './api/policy-docs.js';
import { registerProjectOverviewRoutes } from './api/project-overview.js';
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
    /** GitHub Actions OIDC verification deps (SDD-010, WO-179): a real, network-backed JWKS resolver
     * in production, a `createLocalJWKSet` built from a throwaway keypair in tests — see
     * `./auth/github-oidc.js`'s module doc comment. Consumed by the code-reports baseline gate. */
    githubOidcJwks: JWTVerifyGetKey;
    oidcJtiStore: OidcJtiStore;
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
  /** The graph store every project's `PgProjectEngine` outbox projection writes to (SDD-007, WO-137).
   * Optional so every existing test that never touches a document/graph route keeps working unchanged;
   * a route that actually needs one calls `requireNeo4j` (`./engine/resolve-pg-project-engine.js`). */
  neo4j?: Neo4jGraphDatabase;
  /** Test-only: a manually-advanced `CollabScheduler` (`./collab/scheduler.js`) so a WO-148 revalidation
   * test never waits out a real 60-second interval. Production leaves this unset (the real `setInterval`). */
  collabScheduler?: CollabScheduler;
  /** Test-only: a manually-flushed `CollabBatchScheduler` (`./collab/batch-scheduler.js`) so a WO-149
   * doc_updates batching test never waits out a real ≤50ms window. */
  collabBatchScheduler?: CollabBatchScheduler;
  /** Test-only: see `./collab/register-collab-route.js`'s own `persistDebounce` doc comment. */
  collabPersistDebounce?: { debounce: number; maxDebounce: number };
  /** Test-only: a `createLocalJWKSet` built from a throwaway keypair (SDD-010, WO-179) so a GitHub
   * OIDC verification test never depends on the real network. Production leaves this unset (the real,
   * network-backed `githubOidcRemoteJwks()`). */
  githubOidcJwks?: JWTVerifyGetKey;
  /** Test-only: an in-memory `OidcJtiStore` instead of `pool`-backed `buildPgOidcJtiStore` — only
   * meaningful when `pool` is also omitted (a real `pool` always gets the real, persistent store, so a
   * `jti` replay is actually caught the way SDD-010 requires in production and every DB-backed test). */
  oidcJtiStore?: OidcJtiStore;
  /** SDD-009: the conversational agent's `/agent/messages` route (WO-172) is only ever registered when
   * this is provided — `main.ts` builds a real `DeepSeekClient` when `env.deepseek` is configured;
   * omitted (the default), the agent is entirely absent from the server, same as today. Every test that
   * exercises it passes a `FakeLlmClient` (SDD-009: "es el único usado en tests y E2E"). */
  llmClient?: LlmClient;
  /** Test-only: an injected `ScannedDocsCache` (WO-261) so a test can count real scan invocations
   * without mocking Postgres. Production always gets a fresh, real `createScannedDocsCache()`. */
  scannedDocsCache?: ScannedDocsCache;
}

/**
 * Fastify factory with no `process`/`env`/`listen` (SDD-006 §Arquitectura): every dependency is passed in
 * so tests can `app.inject()` against it directly. This slice (WO-088/WO-091/WO-093) wires `env`, a
 * secret-redacting `logger`, `clock` and (when `pool`+`mailer` are given) better-auth mounted behind
 * its allowlist on `/api/auth/*` — `graph`, `llm` and `oidc` land with the SDD-006 tasks that need them.
 */
export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const {
    env,
    logger = true,
    clock = () => new Date(),
    pool,
    mailer,
    rateLimitStore,
    staticDir,
    neo4j,
    collabScheduler = realCollabScheduler,
    collabBatchScheduler = realCollabBatchScheduler,
    collabPersistDebounce,
    llmClient,
    githubOidcJwks = githubOidcRemoteJwks(),
    oidcJtiStore,
    scannedDocsCache,
  } = deps;
  // Fastify only derives `request.ip`/`request.hostname` from X-Forwarded-* headers when this is
  // set (SDD-006 §Autenticación): same PRDM_TRUST_PROXY gate as the /api/auth/* Host guard and,
  // later, @fastify/rate-limit's IP source (WO-095) — one flag, one trust decision, everywhere.
  const app = Fastify({ logger: resolveLoggerOption(logger), trustProxy: env.trustProxy });

  app.decorate('env', env);
  app.decorate('clock', clock);
  app.decorate('githubOidcJwks', githubOidcJwks);
  // A real `pool` always gets the real, persistent store (SDD-010: a `jti` replay must be caught
  // across process restarts and server instances) unless a test explicitly overrides it; no `pool`
  // falls back to the in-process-only store purely so constructing a default never crashes.
  app.decorate('oidcJtiStore', oidcJtiStore ?? (pool ? buildPgOidcJtiStore(pool) : createInMemoryOidcJtiStore()));

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
      if (pathname === '/') {
        // Read + inject rather than `reply.sendFile('/index.html')`: the CSP nonce (SDD-008 §"Editor")
        // is per-request, and `sendFile` streams the static bytes unchanged.
        const html = readFileSync(join(staticDir, 'index.html'), 'utf8');
        void reply.type('text/html').send(injectCspNonce(html, request.cspNonce));
        return;
      }
      void reply.sendFile(pathname);
    });
  }

  if (pool && mailer) {
    // Created before `buildAuth` (WO-220) so its `databaseHooks.session.delete.after` hook can call
    // `revokeUser` the instant better-auth deletes a session row — `attach()` (giving it the live
    // `Hocuspocus` instance) still happens later, once `registerCollabRoute` constructs one.
    const collabRevocationHub: CollabRevocationHub = createCollabRevocationHub();
    // WO-253/WO-258: same "built before buildAuth" reasoning as collabRevocationHub above — its
    // databaseHooks.session.delete.after hook needs both hubs to exist before it's constructed.
    const agentStreamRevocationHub: AgentStreamRevocationHub = createAgentStreamRevocationHub();
    const auth = buildAuth({ env, pool, mailer, clock, collabRevocationHub, agentStreamRevocationHub });
    app.decorate('auth', auth);
    // `global: false`: no route is rate-limited unless it opts in explicitly (register-auth.ts does,
    // per-path, via the exported keyed helper) — this plugin only ever supplies `app.createRateLimit`.
    void app.register(rateLimitPlugin, { global: false, store: rateLimitStore });
    // SDD-008: same fire-and-register-then-`app.after` sequencing as the two plugins below.
    registerCollabWebsocketPlugin(app, env);
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
      registerProjectRoutes(app, { auth, pool, env, collabRevocationHub });
      registerProjectOverviewRoutes(app, { auth, pool, env, neo4j });
      registerDocumentRoutes(app, { auth, pool, env, collabRevocationHub });
      const hocuspocus = registerCollabRoute(app, {
        auth,
        pool,
        env,
        revocationHub: collabRevocationHub,
        scheduler: collabScheduler,
        batchScheduler: collabBatchScheduler,
        persistDebounce: collabPersistDebounce,
        clock,
        neo4j,
      });
      registerDocumentPublishRoute(app, { auth, pool, env, neo4j });
      registerDocumentBlameRoute(app, { auth, pool, env, blameCache: createBlameCache() });
      registerDocumentVersionRoutes(app, { auth, pool, env, hocuspocus });
      registerDocumentCommentRoutes(app, { auth, pool, env, hocuspocus, rateLimiter: buildCommentRateLimiter(app) });
      if (llmClient)
        registerDocumentAgentRoutes(app, {
          auth,
          pool,
          env,
          neo4j,
          llmClient,
          model: env.deepseek?.model,
          hocuspocus,
          rateLimiter: buildAgentRateLimiter(app, env.agentQuotas.rpmPerUser),
          clock,
          agentStreamRevocationHub,
        });
      registerDriftRoutes(app, { auth, pool, env, neo4j });
      registerForcePushOverrideRoutes(app, { auth, pool, env });
      registerGraphRoutes(app, { auth, pool, env, neo4j });
      registerLineBoardRoutes(app, { auth, pool, env, neo4j });
      registerCloseFeatureRoutes(app, { auth, pool, env, neo4j, hocuspocus });
      registerInvitationAcceptRoute(app, { auth, pool, env, rateLimiter: buildInvitationAcceptRateLimiter(app) });
      registerTokenRoutes(app, { auth, pool, env, clock });
      registerCiTokenRoutes(app, { auth, pool, env, clock });
      registerV1MeRoute(app, { pool });
      registerGovernanceRoutes(app, { pool });
      registerCodeReportRoutes(app, { pool, neo4j, rateLimiter: buildCodeReportRateLimiter(app), scannedDocsCache });
      registerPolicyDocsRoutes(app, { pool });
      registerMcpRemoteRoutes(app, { pool, neo4j, rateLimiter: buildMcpToolRateLimiter(app, DEFAULT_MCP_TOOL_RATE_LIMIT_PER_MINUTE) });
      registerImportRoutes(app, { pool, rateLimiter: buildImportRateLimiter(app) });
    });
  }

  setErrorHandler(app);
  setNotFoundHandler(app, { staticDir });

  return app;
}
