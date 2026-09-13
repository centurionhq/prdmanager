/**
 * Mirrors `packages/web/src/errors.ts`'s `ApiError` shape (SDD-005 "Errores") without importing that server
 * file: `tsconfig.client.json` scopes its program to `src/client/**` (`rootDir: 'src/client'`, `composite: true`),
 * so a relative import reaching outside that tree would break the client/server build split documented in
 * SDD-005 "Build: servidor y cliente no comparten dist".
 */
export type ApiErrorCode = 'validation_error' | 'not_found' | 'internal_error';

/**
 * Thrown by every `api/client.ts` function on a non-2xx `/api/*` response or a body that isn't valid,
 * `ApiError`-shaped JSON. `code` is `'unknown'` when the server didn't reply with the expected envelope
 * (e.g. a proxy error page, a dropped connection, or a truncated response).
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
