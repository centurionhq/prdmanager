/** Type declarations for deploy.mjs's exports (WO-584) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/server/tests/unit/deploy-script.test.ts` typechecks. */
import type { Stage, RunStagesResult } from '../../../scripts/hooks/pre-push-lib.d.mts';
import type { StartGuardResult } from '../../../scripts/rsi/start-guard.d.mts';

export declare const SERVICE_NAME: string;

export declare function buildDeployStages(): Stage[];

export interface RunDeployOptions {
  stages?: Stage[];
}

export declare function runDeploy(options?: RunDeployOptions): Promise<RunStagesResult>;

export interface GuardAndDeployOptions {
  enforceGuard?: () => StartGuardResult;
  deploy?: () => Promise<RunStagesResult>;
  log?: { warn?: (line: string) => void; error: (line: string) => void };
}

export declare function guardAndDeploy(options?: GuardAndDeployOptions): Promise<RunStagesResult>;
