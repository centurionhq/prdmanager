/**
 * SDD-006 §Arquitectura's shared error envelope (`{error:{code,message}}`), typed on the frontend
 * (WO-116): mirrors `packages/web/src/client/api/api-client-error.ts`'s shape, but its `code` union is
 * `@prdm/contracts`'s `ErrorCode` (the full SDD-006 set) instead of PRD-004's smaller one.
 */
import type { ErrorCode } from '@prdm/contracts';

export type ApiErrorCode = ErrorCode;

/**
 * A handful of routes (`project-work-orders.ts`'s `commit_not_verified_by_ci`,
 * `project-feedback.ts`'s `pending_republish` — the same pattern `code-reports.ts` already uses for
 * `docs_outdated`/`idempotency_mismatch`) reply `{error: '<flat_code>', message}` instead of the shared
 * `{error: {code, message}}` envelope: they're ad-hoc, route-specific outcomes, not part of SDD-006's
 * general error taxonomy. `FlatApiErrorCode` keeps known ones autocompletable while `(string & {})` still
 * accepts any future flat code without a contracts change.
 */
export type FlatApiErrorCode = 'commit_not_verified_by_ci' | 'pending_republish' | (string & {});

/**
 * Thrown by every function in `./client.ts` on a non-2xx response or a body that isn't valid,
 * envelope-shaped JSON. `code` is `'unknown'` when the server didn't reply with the expected envelope
 * (a proxy error page, a dropped connection, a truncated response, or a better-auth response that uses
 * its own, differently-shaped error format).
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | FlatApiErrorCode | 'unknown';

  constructor(status: number, code: ApiErrorCode | FlatApiErrorCode | 'unknown', message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}
