/** Type declarations for driver-lib.mjs's exports (WO-588) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/server/tests/unit/rsi-driver.test.ts` typechecks. Every
 * path here is always a plain string (never a Buffer/URL, unlike `fs`'s own broader `PathLike`), so the
 * injectable deps below use plain `string`-keyed signatures rather than `typeof fs.existsSync` etc. --
 * matching how the real code actually calls them and how the tests' in-memory fakes are shaped. */
export declare const FAILURE_THRESHOLD: number;
export declare const MIN_INTERVAL_MS: number;
export declare const IDLE_INTERVAL_MS: number;

export interface LoopState {
  consecutiveFailures: number;
  pausedReason: string | null;
  lastCycleAt: string | null;
}

export interface CycleOutcome {
  success: boolean;
  backlogRemaining: boolean;
  rollbackFailed: boolean;
  raw?: unknown;
}

export interface ReadStateDeps {
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string, encoding: 'utf8') => string;
}

export interface WriteStateDeps {
  mkdirSync?: (path: string, options: { recursive: true }) => unknown;
  writeFileSync?: (path: string, content: string) => void;
  renameSync?: (from: string, to: string) => void;
}

export interface IsPausedDeps {
  existsSync?: (path: string) => boolean;
}

export declare function defaultState(): LoopState;
export declare function readState(statePath: string, deps?: ReadStateDeps): LoopState;
export declare function writeState(statePath: string, state: LoopState, deps?: WriteStateDeps): void;
export declare function isPaused(pausePath: string, deps?: IsPausedDeps): boolean;
export declare function parseCycleOutcome(stdout: string): CycleOutcome;
export declare function nextState(state: LoopState, outcome: CycleOutcome, nowIso: string): LoopState;
export declare function computeDelayMs(outcome: CycleOutcome): number;

export interface RunCycleOnceOptions {
  statePath: string;
  pausePath: string;
  runClaude: () => Promise<{ stdout: string }>;
  now?: () => string;
  fsDeps?: ReadStateDeps & WriteStateDeps & IsPausedDeps;
}

export interface RunCycleOnceResult {
  ran: boolean;
  reason?: string;
  outcome?: CycleOutcome;
  state: LoopState;
  delayMs: number | null;
}

export declare function runCycleOnce(options: RunCycleOnceOptions): Promise<RunCycleOnceResult>;
