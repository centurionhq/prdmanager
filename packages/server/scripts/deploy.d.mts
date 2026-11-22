/** Type declarations for deploy.mjs's exports (WO-584) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/server/tests/unit/deploy-script.test.ts` typechecks. */
import type { Stage, RunStagesResult } from '../../../scripts/hooks/pre-push-lib.d.mts';
import type { StartGuardResult } from '../../../scripts/rsi/start-guard.d.mts';

export declare const SERVICE_NAME: string;

export interface SystemctlResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type SystemctlRun = (args: string[]) => SystemctlResult;
export interface UnitState {
  previousMainPid?: number;
}

export declare function systemctlRunner(options?: { spawn?: (...args: any[]) => any }): SystemctlRun;
export declare function readMainPid(serviceName: string, run: SystemctlRun): number;
export declare function readActiveState(serviceName: string, run: SystemctlRun): string;

export interface RestartStageOptions {
  serviceName?: string;
  systemctl?: SystemctlRun;
  unitState?: UnitState;
}
export declare function buildRestartStage(options?: RestartStageOptions): Stage;

export interface VerifyStageOptions extends RestartStageOptions {
  attempts?: number;
  sleepMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
export declare function buildVerifyStage(options?: VerifyStageOptions): Stage;

export interface BuildDeployStagesOptions {
  serviceName?: string;
  systemctl?: SystemctlRun;
}
export declare function buildDeployStages(options?: BuildDeployStagesOptions): Stage[];

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
