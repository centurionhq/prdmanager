import { errorEnvelope, type ErrorCode } from '@prdm/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
};

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

/**
 * Single central error handler (SDD-006 §Arquitectura): any `HttpError` subclass maps to its own status
 * and message; anything else is logged in full server-side and reported to the client as a fixed
 * `"internal error"` string — a raw driver/library error can embed a connection string or a stack frame,
 * so `err.message` never reaches the response body.
 */
export function setErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) {
      sendError(reply, err.code, err.message);
      return;
    }
    if (isCsrfError(err)) {
      sendError(reply, 'forbidden', 'invalid csrf token');
      return;
    }
    request.log.error({ err }, 'unhandled error in packages/server');
    sendError(reply, 'internal_error', 'internal error');
  });
}

/** Every unmatched route is a JSON 404 with the shared envelope; there is no SPA/static fallback in packages/server. */
export function setNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    sendError(reply, 'not_found', 'route not found');
  });
}
