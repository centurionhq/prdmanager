import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseBusyError, StatementTimedOutError } from '@prdm/core';
import { errorEnvelope, type ErrorCode } from '@prdm/contracts';
import type {} from '@fastify/static'; // module augmentation: adds `reply.sendFile` to FastifyReply's type.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { injectCspNonce } from './spa-html.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  internal_error: 500,
  service_unavailable: 503,
};

/** Same value as the default `connectionTimeoutMillis` of `@prdm/db`'s `createPool` (5 s). */
const DB_BUSY_RETRY_AFTER_SECONDS = 5;

/**
 * Base of every error a route handler throws on purpose (SDD-006 §Arquitectura). `internal_error` is
 * deliberately excluded from the constructor's `code`: an unexpected, non-`HttpError` exception is what
 * maps to it, never a handler raising one directly with an arbitrary message (that would defeat the "500
 * never leaks the real message" rule below).
 */
export class HttpError extends Error {
  constructor(
    public readonly code: Exclude<ErrorCode, 'internal_error'>,
    message: string,
  ) {
    super(message);
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super('validation_error', message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'unauthorized') {
    super('unauthorized', message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'forbidden') {
    super('forbidden', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'not found') {
    super('not_found', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super('conflict', message);
  }
}

export class RateLimitedError extends HttpError {
  constructor(message = 'rate limited') {
    super('rate_limited', message);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super('service_unavailable', message);
  }
}

function sendError(reply: FastifyReply, code: ErrorCode, message: string): void {
  void reply.code(STATUS_BY_CODE[code]).send(errorEnvelope(code, message));
}

/** `@fastify/csrf-protection` (WO-108) reports failures via `reply.send(new SomeCsrfError())` rather than
 * throwing, but a sent `Error` instance still flows through this same `setErrorHandler` (verified against
 * the plugin's actual behavior) — recognized by its `FST_CSRF_*` error code (`FST_CSRF_MISSING_SECRET`,
 * `FST_CSRF_INVALID_TOKEN`) rather than an `instanceof` check, since the plugin doesn't export its error
 * classes. Mapped to the same shared 403 envelope every other `ForbiddenError` gets, never leaking the
 * plugin's own message/shape. */
function isCsrfError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string' && (err as { code: string }).code.startsWith('FST_CSRF_');
}

/** Fastify's built-in `FST_ERR_CTP_BODY_TOO_LARGE` (a route's `bodyLimit` was exceeded) — recognized by
 * code, not `instanceof`, same as `isCsrfError`: the core doesn't export the error class. */
function isBodyTooLargeError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'FST_ERR_CTP_BODY_TOO_LARGE';
}

/**
 * Single central error handler (SDD-006 §Arquitectura): any `HttpError` subclass maps to its own status
 * and message; anything else is logged in full server-side and reported to the client as a fixed
 * `"internal error"` string — a raw driver/library error can embed a connection string or a stack frame,
 * so `err.message` never reaches the response body.
 */
export function setErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof DatabaseBusyError || err instanceof StatementTimedOutError) {
      request.log.error({ err }, 'database timeout');
      if (err instanceof DatabaseBusyError) void reply.header('retry-after', String(DB_BUSY_RETRY_AFTER_SECONDS));
      sendError(reply, 'service_unavailable', err instanceof DatabaseBusyError ? 'database busy, retry shortly' : 'statement timed out');
      return;
    }
    if (err instanceof HttpError) {
      if (err instanceof ServiceUnavailableError && err.retryAfterSeconds !== undefined) void reply.header('retry-after', String(err.retryAfterSeconds));
      sendError(reply, err.code, err.message);
      return;
    }
    if (isCsrfError(err)) {
      sendError(reply, 'forbidden', 'invalid csrf token');
      return;
    }
    if (isBodyTooLargeError(err)) {
      sendError(reply, 'payload_too_large', 'request body exceeds the allowed limit for this endpoint');
      return;
    }
    request.log.error({ err }, 'unhandled error in packages/server');
    sendError(reply, 'internal_error', 'internal error');
  });
}

export interface NotFoundHandlerOptions {
  /** `@fastify/static`'s registered root (SDD-006 "Local y despliegue": packages/app's built bundle) —
   * `undefined` when no static bundle was ever configured. Kept as the real path (not just a boolean)
   * so this handler can read `index.html` itself and inject the per-request CSP nonce (SDD-008 §"Editor")
   * rather than streaming the file byte-for-byte unchanged via `reply.sendFile`. */
  staticDir?: string;
}

/**
 * Every unmatched `/api/*` (and, defensively, `/collab`/`/mcp` — SDD-008/SDD-010 haven't wired their own routes
 * yet, but a request that reaches this handler for either prefix must still get the shared JSON envelope, never
 * the SPA shell) is a JSON 404. Everything else falls back to `packages/app`'s `index.html` once `staticDir` was
 * given to `buildServer` (client-side routing, mirrors `packages/web/src/errors.ts`'s own `setNotFoundHandler`);
 * with no `staticDir` this degrades to the same JSON 404 instead of crashing.
 */
export function setNotFoundHandler(app: FastifyInstance, options: NotFoundHandlerOptions = {}): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const isPlatformRoute = request.url.startsWith('/api/') || request.url.startsWith('/collab') || request.url.startsWith('/mcp');
    if (!isPlatformRoute && options.staticDir) {
      const html = readFileSync(join(options.staticDir, 'index.html'), 'utf8');
      void reply.type('text/html').send(injectCspNonce(html, request.cspNonce));
      return;
    }
    sendError(reply, 'not_found', 'route not found');
  });
}
