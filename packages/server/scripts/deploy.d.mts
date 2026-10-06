/** Type declarations for deploy.mjs's exports (WO-584) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/server/tests/unit/deploy-script.test.ts` typechecks. */
import type { Stage, RunStagesResult } from '../../../scripts/hooks/pre-push-lib.d.mts';

export declare const SERVICE_NAME: string;

export declare function buildDeployStages(): Stage[];

export interface RunDeployOptions {
  stages?: Stage[];
}

export declare function runDeploy(options?: RunDeployOptions): Promise<RunStagesResult>;
