import type {} from '@fastify/static'; // module augmentation: adds `reply.sendFile` to FastifyReply's type.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** SDD-005 "Errores": the only shape every `/api/*` response ever uses for a failure. */
export interface ApiError {
  error: {
    code: 'validation_error' | 'not_found' | 'internal_error';
    message: string;
  };
}

/** Thrown by route handlers when `zod`'s `safeParse` fails on `params`/`query`; maps to HTTP 400. */
export class ValidationError extends Error {}

/** Thrown by route handlers when core returns `null` for a known-shaped-but-nonexistent id; maps to HTTP 404. */
export class NotFoundError extends Error {}

function sendError(reply: FastifyReply, status: number, code: ApiError['error']['code'], message: string): void {
  const body: ApiError = { error: { code, message } };
  void reply.code(status).send(body);
}

/**
 * Single central error handler (SDD-005 "Errores"): `ValidationError`/`NotFoundError` map to 400/404 with their
 * own message; anything else is logged in full server-side and reported to the client as a fixed
 * `"internal error"` string — never `err.message`, since a Neo4j driver error can embed its connection URI.
 */
export function setErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ValidationError) {
      sendError(reply, 400, 'validation_error', err.message);
      return;
    }
    if (err instanceof NotFoundError) {
      sendError(reply, 404, 'not_found', err.message);
      return;
    }
    request.log.error({ err }, 'unhandled error in packages/web API');
    sendError(reply, 500, 'internal_error', 'internal error');
  });
}

export interface NotFoundHandlerOptions {
  /** Whether `@fastify/static` was registered against a `staticDir` (SDD-005 "Arquitectura" — build: servidor y cliente). */
  hasStatic: boolean;
}

/**
 * Distinguishes `/api/*` (always a JSON 404, never `index.html`) from everything else. Non-`/api` paths fall back
 * to the SPA once `@fastify/static` is registered (WO-056); until then — or when `staticDir` was never provided —
 * this degrades to the same JSON 404 instead of crashing.
 */
export function setNotFoundHandler(app: FastifyInstance, options: NotFoundHandlerOptions = { hasStatic: false }): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/api/')) {
      sendError(reply, 404, 'not_found', 'route not found');
      return;
    }
    if (options.hasStatic) {
      void reply.type('text/html').sendFile('index.html');
      return;
    }
    sendError(reply, 404, 'not_found', 'route not found');
  });
}
