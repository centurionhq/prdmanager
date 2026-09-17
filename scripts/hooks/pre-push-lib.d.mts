/** Type declarations for pre-push-lib.mjs's exports (WO-409) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/server/tests/unit/pre-push-hook.test.ts` typechecks. */
export interface StageOutcome {
  success: boolean;
  exitCode?: number;
  message?: string;
}

export interface Stage {
  name: string;
  run: () => StageOutcome | Promise<StageOutcome>;
}

export interface RunStagesResult {
  success: boolean;
  failedStage: string | null;
  exitCode: number;
}

export interface RunStagesOptions {
  now?: () => number;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

export declare function isSkipped(env?: NodeJS.ProcessEnv): boolean;

export declare function runStages(stages: Stage[], options?: RunStagesOptions): Promise<RunStagesResult>;

export interface FindChromiumInstallDirOptions {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  existsSync?: (path: string) => boolean;
  readdirSync?: (path: string) => string[];
}

export declare function findChromiumInstallDir(options?: FindChromiumInstallDirOptions): string | null;
