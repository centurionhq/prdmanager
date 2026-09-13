/**
 * Drizzle schema for the prdm SaaS platform (SDD-006 §Modelo de datos).
 *
 * No tables exist yet in this slice (WO-087 only scaffolds the package); better-auth's tables,
 * `projects`, `project_members` and the rest of the schema land in later work orders. Keeping this
 * module (even empty) gives `drizzle-kit generate` and `drizzle.config.ts` a stable target so the
 * migrations directory is wired correctly from the start.
 */
export {};
