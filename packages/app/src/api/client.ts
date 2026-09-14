/**
 * Typed API client entry point (SDD-006 §Dashboard shell: "cliente de API tipado con contracts, CSRF y
 * errores", WO-116). Every screen imports from here rather than reaching into the individual modules
 * directly, mirroring `packages/web/src/client/api/client.ts`'s role as the single barrel for its own
 * `api/*` functions.
 */
export { ApiClientError, type ApiErrorCode } from './api-client-error.js';
export * from './auth.js';
export * from './organizations.js';
export * from './invitations.js';
export * from './projects.js';
export * from './documents.js';
export * from './comments.js';
export * from './versions.js';
export * from './graph.js';
export * from './tokens.js';
export * from './admin.js';
