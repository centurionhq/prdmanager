/**
 * Browser-safe subpath (WO-129/SDD-007): only the zod schemas/constants/types this module itself defines, with
 * no dependency beyond `zod` (verified against `schema.ts`'s own imports) — never `node:fs`, never
 * `neo4j-driver`, never anything that reaches disk or a database. Consumers like `packages/app`/`packages/ui`
 * (and, once it exists, `packages/collab`) import VALUES only from here, never from the root `@prdm/core`
 * barrel (see the guard test in `packages/core/tests/unit/no-core-value-import.test.ts`).
 */
export * from './schema.js';
