/**
 * Drizzle schema for the prdm SaaS platform (SDD-006 §Modelo de datos).
 *
 * Split by concern under `./schema/`; this barrel is what `drizzle.config.ts` points `drizzle-kit
 * generate` at and what `packages/db/src/pool.ts` binds the query builder to.
 */
export * from './schema/auth.js';
export * from './schema/user-profile.js';
export * from './schema/projects.js';
export * from './schema/audit.js';
export * from './schema/invitations.js';
export * from './schema/tokens.js';
export * from './schema/custom-types.js';
export * from './schema/documents.js';
export * from './schema/doc-updates.js';
export * from './schema/doc-client-bindings.js';
export * from './schema/doc-comments.js';
export * from './schema/agent.js';
export * from './schema/code-reports.js';
export * from './schema/oidc.js';
