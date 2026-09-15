/**
 * SDD-006 §Arquitectura's shared error envelope (`{error:{code,message}}`), typed on the frontend
 * (WO-116): mirrors `packages/web/src/client/api/api-client-error.ts`'s shape, but its `code` union is
 * `@prdm/contracts`'s `ErrorCode` (the full SDD-006 set) instead of PRD-004's smaller one.
 */
import type { ErrorCode } from '@prdm/contracts';

export type ApiErrorCode = ErrorCode;

/**
 * Thrown by every function in `./client.ts` on a non-2xx response or a body that isn't valid,
 * envelope-shaped JSON. `code` is `'unknown'` when the server didn't reply with the expected envelope
 * (a proxy error page, a dropped connection, a truncated response, or a better-auth response that uses
 * its own, differently-shaped error format).
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'unknown';

  constructor(status: number, code: ApiErrorCode | 'unknown', message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}
