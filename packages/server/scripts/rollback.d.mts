/** Type declarations for rollback.mjs's exports (WO-585) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/server/tests/unit/rollback-script.test.ts` typechecks. */
import type { Stage, RunStagesResult } from '../../../scripts/hooks/pre-push-lib.d.mts';

export declare const SHA_PATTERN: RegExp;

export declare function isValidSha(sha: string): boolean;

export interface RunRollbackOptions {
  stages?: Stage[];
}

export declare function runRollback(sha: string, options?: RunRollbackOptions): Promise<RunStagesResult>;
