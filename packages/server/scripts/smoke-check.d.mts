/** Type declarations for smoke-check.mjs's exports (WO-586) — picked up automatically for `.mjs` under
 * `nodenext` module resolution, so `packages/server/tests/unit/smoke-check-script.test.ts` typechecks. */
export interface SmokeCheckOptions {
  port?: string;
  attempts?: number;
  delayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface SmokeCheckResult {
  ok: boolean;
  attempts: number;
  lastError?: string;
}

export declare function smokeCheck(options?: SmokeCheckOptions): Promise<SmokeCheckResult>;
