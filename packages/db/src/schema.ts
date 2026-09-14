/**
 * Drizzle schema for the prdm SaaS platform (SDD-006 §Modelo de datos).
 *
 * Split by concern under `./schema/`; this barrel is what `drizzle.config.ts` points `drizzle-kit
 * generate` at and what `packages/db/src/pool.ts` binds the query builder to.
 */
export * from './schema/auth.js';
export * from './schema/user-profile.js';
export * from './schema/projects.js';
