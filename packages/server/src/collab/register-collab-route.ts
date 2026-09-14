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
 * The resolved user id (and, for WO-148's periodic revalidation, the raw session cookie) seeds
 * `handleConnection`'s `defaultContext`; `./authenticate.js`'s `onAuthenticate` then does the
 * per-document authorization (role, read-only, generated/archived) once per `documentName`.
 */
import fastifyWebsocket from '@fastify/websocket';
import { Hocuspocus, type Extension } from '@hocuspocus/server';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { requireAppSession } from '../api/app-session.js';
import { createCollabAntiSpoofingExtension } from './anti-spoofing.js';
import { createCollabAttributionExtension } from './attribution.js';
import { createCollabAuthenticateExtension, type CollabAuthContext } from './authenticate.js';
import { realCollabBatchScheduler, type CollabBatchScheduler } from './batch-scheduler.js';
import { createDocUpdateBatcher } from './doc-update-writer.js';
import { isTrustedCollabOrigin } from './origin-check.js';
import { createCollabPersistenceExtension } from './persistence.js';
import { createCollabRevalidateExtension } from './revalidate.js';
import { createCollabRevocationHub, type CollabRevocationHub } from './revocation.js';
import { realCollabScheduler, type CollabScheduler } from './scheduler.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `/collab`'s own `preValidation` once the upgrade's session is resolved; absent (and never
     * read) on every other route. */
    collabUserId?: string;
    collabSessionCookie?: string;
  }
}

export interface RegisterCollabRouteOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  /** Attached to the constructed `Hocuspocus` instance so `projects.ts`/`documents.ts` can close
   * affected connections right after a membership/archive write commits (WO-148). Defaults to a
   * freshly created, unattached-elsewhere hub when omitted (every existing caller keeps working
   * unchanged; it simply has no other route revoking through it). */
  revocationHub?: CollabRevocationHub;
  /** Injected so tests never wait out a real 60-second interval (WO-148, `./scheduler.js`). */
  scheduler?: CollabScheduler;
  /** Injected so tests never wait out a real ≤50ms batch window (WO-149, `./batch-scheduler.js`). */
  batchScheduler?: CollabBatchScheduler;
  /** Test-only: forwarded to `Hocuspocus`'s own `debounce`/`maxDebounce` (the `onStoreDocument`
   * snapshot, unrelated to WO-149's own ≤50ms `doc_updates` batching window). Left unset in production
   * (Hocuspocus's own defaults apply); a test that closes its server shortly after an edit sets both to
   * `0` so the debounced store fires — and finishes — before the test's own pool closes, instead of on
   * a real timer that could otherwise still be pending afterward (caught and merely logged by
   * Hocuspocus itself, never a thrown error, but avoided here rather than tolerated). */
  persistDebounce?: { debounce: number; maxDebounce: number };
}

/** Extra extensions a later WO composes in (WO-150 anti-spoofing, WO-151 awareness/stateless, WO-152
 * limits) — kept as an explicit seam so this route registration never has to change shape again, only
 * the array passed here. */
export interface CollabExtensionsDeps {
  auth: Auth;
  pool: Pool;
  scheduler: CollabScheduler;
  batchScheduler: CollabBatchScheduler;
}

export function buildCollabExtensions(deps: CollabExtensionsDeps): Extension[] {
  const batcher = createDocUpdateBatcher({ pool: deps.pool, scheduler: deps.batchScheduler });
  return [
    createCollabAuthenticateExtension({ pool: deps.pool }) as unknown as Extension,
    createCollabPersistenceExtension({ pool: deps.pool }) as unknown as Extension,
    createCollabRevalidateExtension({ auth: deps.auth, pool: deps.pool, scheduler: deps.scheduler }) as unknown as Extension,
    // Order matters for the two `beforeSync` extensions below: Hocuspocus runs each extension's
    // `beforeSync` in array order, awaiting each before the next — anti-spoofing must reject (throw)
    // *before* attribution ever durably logs the update, so it comes first.
    createCollabAntiSpoofingExtension({ pool: deps.pool }) as unknown as Extension,
    createCollabAttributionExtension({ batcher }) as unknown as Extension,
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
  const { auth, pool, env, revocationHub = createCollabRevocationHub(), scheduler = realCollabScheduler, batchScheduler = realCollabBatchScheduler, persistDebounce } = opts;

  const hocuspocus = new Hocuspocus({
    yDocOptions: { gc: false, gcFilter: () => true },
    ...persistDebounce,
    extensions: buildCollabExtensions({ auth, pool, scheduler, batchScheduler }),
  });
  revocationHub.attach(hocuspocus);

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
          req.collabSessionCookie = req.headers.cookie;
        } catch {
          await reply.code(401).send();
        }
      },
    },
    (socket, request) => {
      const userId = request.collabUserId;
      const sessionCookie = request.collabSessionCookie;
      if (!userId || !sessionCookie) {
        // preValidation already rejected the HTTP upgrade in this case; reaching here with no userId
        // would only happen if a future change wires this route without that hook — fail closed.
        socket.close(1008, 'unauthorized');
        return;
      }
      const defaultContext: CollabAuthContext = { userId, sessionCookie };
      const connection = hocuspocus.handleConnection(socket, request.raw as unknown as Request, defaultContext);
      socket.on('message', (data: Uint8Array) => connection.handleMessage(data));
      socket.on('close', (event: unknown) => connection.handleClose(event as never));
    },
  );
}
