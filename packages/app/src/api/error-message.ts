import { ApiClientError } from './api-client-error.js';

/** Every screen's catch block goes through this: an `ApiClientError`'s own `message` is always a
 * server-authored, safe-to-display string (SDD-006 §Arquitectura: a 500 never leaks the real message, so
 * even `internal_error`'s message is already the generic "internal error"). Anything else (a network
 * failure, an unexpected throw) gets a fixed, generic fallback rather than an `Error`'s raw `.message`,
 * which might not be end-user-appropriate. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return 'Ocurrió un error inesperado. Probá de nuevo.';
}
