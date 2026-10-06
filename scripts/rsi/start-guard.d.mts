/** Type declarations for start-guard.mjs (WO-610 / SDD-063). */
export declare const DEFAULT_INTEGRATION_BRANCH: string;
export declare const INTEGRATION_BRANCH_ENV: string;
export declare const ALLOW_DIRTY_START_ENV: string;

export interface StartGuardResult {
  ok: boolean;
  expectedBranch: string;
  currentBranch: string | null;
  dirtyFiles: string[];
  unpushedCount: number | null;
  hasUpstream: boolean;
  problems: string[];
  warnings: string[];
}

export interface GitRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CheckRepoStartOptions {
  cwd?: string;
  integrationBranch?: string;
  allowDirtyStart?: boolean;
  env?: NodeJS.ProcessEnv;
  runGit?: (args: string[], opts: { cwd: string }) => GitRunResult;
}

export interface GuardLog {
  warn: (line: string) => void;
  error: (line: string) => void;
}

export declare function checkRepoStart(options?: CheckRepoStartOptions): StartGuardResult;
export declare function reportStartGuard(result: StartGuardResult, log?: GuardLog): void;
export declare function enforceStartGuard(options?: CheckRepoStartOptions & { log?: GuardLog }): StartGuardResult;
