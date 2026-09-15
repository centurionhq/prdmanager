import { ApiClientError, type ApiErrorCode } from './api-client-error.js';

/** SDD-013 §"Capa de datos": these two codes get a fixed Spanish copy regardless of the server's own
 * message — `rate_limited`'s and `not_found`'s server-authored text is written for logs/other clients,
 * not tuned for an end user reading it in the UI. Every other code still uses the server's own message
 * (see `errorMessage` below). */
const CODE_MESSAGE_OVERRIDES: Partial<Record<ApiErrorCode | 'unknown', string>> = {
  rate_limited: 'Demasiados intentos. Probá de nuevo en un momento.',
  not_found: 'No encontramos lo que buscabas.',
};

/** Every screen's catch block goes through this: an `ApiClientError`'s own `message` is always a
 * server-authored, safe-to-display string (SDD-006 §Arquitectura: a 500 never leaks the real message, so
 * even `internal_error`'s message is already the generic "internal error"). Anything else (a network
 * failure, an unexpected throw) gets a fixed, generic fallback rather than an `Error`'s raw `.message`,
 * which might not be end-user-appropriate. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return CODE_MESSAGE_OVERRIDES[error.code as ApiErrorCode | 'unknown'] ?? error.message;
  return 'Ocurrió un error inesperado. Probá de nuevo.';
}
