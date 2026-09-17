/** Type declarations for pre-commit-lib.mjs's exports (WO-408) — picked up automatically for `.mjs`
 * under `nodenext` module resolution, so `packages/server/tests/unit/pre-commit-hook.test.ts`
 * typechecks. */
export declare function isRelevantPath(path: string): boolean;
export declare function filterRelevantFiles(paths: string[]): string[];
export declare function parseStagedFiles(rawOutput: string): string[];
export declare function parseDbRelatedCount(rawOutput: string): number | null;
