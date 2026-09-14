/**
 * Mounts `GET /collab` (SDD-008 §"Servidor de tiempo real"): `@fastify/websocket` hands the raw `ws`
 * socket to an embedded `Hocuspocus` instance exactly like `packages/server/tests/learning/
 * hocuspocus-fastify.test.ts` confirmed for 4.7.0 — `handleConnection` doesn't wire the socket's own
 * events, so this route does `socket.on('message'|'close', ...)` itself.
 *
 * Two checks run in the route's `preValidation` — a normal Fastify hook, confirmed by `@fastify/
 * websocket`'s own README to run (and to be able to reject) *before* the WebSocket upgrade completes —
 * so neither one ever lets Hocuspocus code run at all when it fails:
 *
 * 1. `Origin` must be present and exactly match `PRDM_TRUSTED_ORIGINS` (`./origin-check.js` — never the
 *    CSRF module's more permissive `Sec-Fetch-Site: same-origin` bypass).
 * 2. A real `/api/app/*`-style session (`requireAppSession`, browser-only — never a Bearer token, this
 *    surface is never reached by the CI/MCP token surface).
 *
 * The resolved user id seeds `handleConnection`'s `defaultContext`; `./authenticate.js`'s `onAuthenticate`
 * then does the per-document authorization (role, read-only, generated/archived) once per `documentName`.
 */
import fastifyWebsocket from '@fastify/websocket';
import { Hocuspocus, type Extension } from '@hocuspocus/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { requireAppSession } from '../api/app-session.js';
import { createCollabAuthenticateExtension, type CollabAuthContext } from './authenticate.js';
import { isTrustedCollabOrigin } from './origin-check.js';
import { createCollabPersistenceExtension } from './persistence.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `/collab`'s own `preValidation` once the upgrade's session is resolved; absent (and never
     * read) on every other route. */
    collabUserId?: string;
  }
}

export interface RegisterCollabRouteOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
}

/** Extra extensions a later WO composes in (WO-148 revocation, WO-149 attribution, WO-150 anti-spoofing,
 * WO-151 awareness/stateless, WO-152 limits) — kept as an explicit seam so this route registration never
 * has to change shape again, only the array passed here. */
export interface CollabExtensionsDeps {
  pool: Pool;
}

export function buildCollabExtensions(deps: CollabExtensionsDeps): Extension[] {
  return [
    createCollabAuthenticateExtension({ pool: deps.pool }) as unknown as Extension,
    createCollabPersistenceExtension({ pool: deps.pool }) as unknown as Extension,
  ];
}

/**
 * Registers `@fastify/websocket` itself. Called *before* `app.after(...)` (same fire-and-register
 * pattern `build-server.ts` already uses for `@fastify/rate-limit`/`@fastify/csrf-protection`) — its
 * `onRoute` hook (which recognizes the `{ websocket: true }` route shorthand) must finish installing
 * before {@link registerCollabRoute} declares `GET /collab` with that option, and `app.after`'s callback
 * is exactly the guarantee that every previously-queued `app.register(...)` has completed by then.
 */
export function registerCollabWebsocketPlugin(app: FastifyInstance, env: ServerEnv): void {
  void app.register(fastifyWebsocket, { options: { maxPayload: env.collabMaxPayloadBytes } });
}

/** Declares `GET /collab` itself — must run after {@link registerCollabWebsocketPlugin}'s plugin has
 * finished registering (see that function's own doc comment), i.e. inside the same `app.after` callback
 * every other `auth`/`pool`-dependent route is registered from. */
export function registerCollabRoute(app: FastifyInstance, opts: RegisterCollabRouteOptions): void {
  const { auth, pool, env } = opts;

  const hocuspocus = new Hocuspocus({
    yDocOptions: { gc: false, gcFilter: () => true },
    extensions: buildCollabExtensions({ pool }),
  });

  app.get(
    '/collab',
    {
      websocket: true,
      config: { access: { kind: 'session' } },
      preValidation: async (req: FastifyRequest, reply) => {
        if (!isTrustedCollabOrigin(req.headers.origin, env.trustedOrigins)) {
          await reply.code(403).send();
          return;
        }
        try {
          const session = await requireAppSession(auth, req, env.publicUrl);
          req.collabUserId = session.user.id;
        } catch {
          await reply.code(401).send();
        }
      },
    },
    (socket, request) => {
      const userId = request.collabUserId;
      if (!userId) {
        // preValidation already rejected the HTTP upgrade in this case; reaching here with no userId
        // would only happen if a future change wires this route without that hook — fail closed.
        socket.close(1008, 'unauthorized');
        return;
      }
      const defaultContext: CollabAuthContext = { userId };
      const connection = hocuspocus.handleConnection(socket, request.raw as unknown as Request, defaultContext);
      socket.on('message', (data: Uint8Array) => connection.handleMessage(data));
      socket.on('close', (event: unknown) => connection.handleClose(event as never));
    },
  );
}
