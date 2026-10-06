/**
 * WO-588 / SDD-057: orchestration logic for `scripts/rsi/driver.mjs`, split out the same way
 * `scripts/hooks/pre-push-lib.mjs` is split from `scripts/hooks/pre-push` (PRD-039 "Mecanismo de
 * orquestación") -- so `packages/server/tests/unit/rsi-driver.test.ts` can exercise the guard/circuit-
 * breaker/pacing logic without ever spawning a real `claude -p` cycle. Every function takes its
 * side-effecting dependencies (filesystem, clock, the `claude` invocation itself) as injectable
 * parameters defaulting to the real ones.
 *
 * State (`loop-state.json`) is machine-local operational bookkeeping, not governed project data -- the
 * prdm-graph itself (WO/FB/FR status) stays the source of truth for *what* was done; this file only
 * tracks the circuit breaker's failure count and pause reason across driver restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const FAILURE_THRESHOLD = 3;
export const MIN_INTERVAL_MS = 15 * 60 * 1000; // floor: never cycle more often than every 15 minutes
export const IDLE_INTERVAL_MS = 3 * 60 * 60 * 1000; // no backlog left: check back in 3 hours

const OUTCOME_START = '<<<RSI_CYCLE_OUTCOME>>>';
const OUTCOME_END = '<<<END>>>';

/** @typedef {{ consecutiveFailures: number, pausedReason: string | null, lastCycleAt: string | null }} LoopState */
/** @typedef {{ success: boolean, backlogRemaining: boolean, rollbackFailed: boolean, raw?: unknown }} CycleOutcome */

/** @returns {LoopState} */
export function defaultState() {
  return { consecutiveFailures: 0, pausedReason: null, lastCycleAt: null };
}

/**
 * @param {string} statePath
 * @param {{ existsSync?: typeof fs.existsSync, readFileSync?: typeof fs.readFileSync }} [deps]
 * @returns {LoopState}
 */
export function readState(statePath, deps = {}) {
  const { existsSync = fs.existsSync, readFileSync = fs.readFileSync } = deps;
  if (!existsSync(statePath)) return defaultState();
  try {
    const parsed = { ...defaultState(), ...JSON.parse(readFileSync(statePath, 'utf8')) };
    // A wrong-shaped value (e.g. `consecutiveFailures` as a string) can silently defeat the
    // `>= FAILURE_THRESHOLD` comparison in `nextState` via NaN -- the circuit breaker is a kill switch,
    // so a malformed file must fall back to a fresh state, not just a JSON-syntax error.
    if (typeof parsed.consecutiveFailures !== 'number' || Number.isNaN(parsed.consecutiveFailures)) return defaultState();
    if (parsed.pausedReason !== null && typeof parsed.pausedReason !== 'string') return defaultState();
    return parsed;
  } catch {
    // A corrupt state file must never crash the loop -- treat it as a fresh start.
    return defaultState();
  }
}

/**
 * @param {string} statePath
 * @param {LoopState} state
 * @param {{ mkdirSync?: typeof fs.mkdirSync, writeFileSync?: typeof fs.writeFileSync, renameSync?: typeof fs.renameSync }} [deps]
 */
export function writeState(statePath, state, deps = {}) {
  const { mkdirSync = fs.mkdirSync, writeFileSync = fs.writeFileSync, renameSync = fs.renameSync } = deps;
  mkdirSync(path.dirname(statePath), { recursive: true });
  // Write-then-rename instead of a direct write: a process killed mid-write must never leave a
  // truncated/corrupt state file, since `readState`'s fallback-to-defaultState on a bad file would
  // silently un-pause the loop -- the wrong direction for a safety mechanism.
  const tmpPath = `${statePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmpPath, statePath);
}

/**
 * @param {string} pausePath
 * @param {{ existsSync?: typeof fs.existsSync }} [deps]
 * @returns {boolean}
 */
export function isPaused(pausePath, deps = {}) {
  const { existsSync = fs.existsSync } = deps;
  return existsSync(pausePath);
}

/**
 * Extracts the cycle's self-reported outcome from `claude -p`'s stdout -- `scripts/rsi/cycle-prompt.md`
 * instructs each cycle to end with a `<<<RSI_CYCLE_OUTCOME>>> {...json...} <<<END>>>` block. Anything
 * that doesn't parse is treated as a failure: an unreadable outcome must never be silently treated as
 * success by the circuit breaker.
 *
 * @param {string} stdout
 * @returns {CycleOutcome}
 */
export function parseCycleOutcome(stdout) {
  const startIndex = stdout.lastIndexOf(OUTCOME_START);
  const endIndex = stdout.indexOf(OUTCOME_END, startIndex);
  if (startIndex === -1 || endIndex === -1) {
    return { success: false, backlogRemaining: false, rollbackFailed: false };
  }
  try {
    const parsed = JSON.parse(stdout.slice(startIndex + OUTCOME_START.length, endIndex));
    return {
      success: parsed.outcome === 'implemented' || parsed.outcome === 'idle',
      backlogRemaining: Boolean(parsed.backlogRemaining),
      rollbackFailed: Boolean(parsed.rollbackFailed),
      raw: parsed,
    };
  } catch {
    return { success: false, backlogRemaining: false, rollbackFailed: false };
  }
}

/**
 * Pure circuit-breaker transition: a `rollbackFailed` outcome pauses immediately (a failed rollback
 * means production may be down, categorically worse than one failed feature cycle -- PRD-039 "Circuit
 * breaker / kill switch"); otherwise `FAILURE_THRESHOLD` consecutive plain failures pause; a success
 * resets the counter and clears any pause.
 *
 * @param {LoopState} state
 * @param {CycleOutcome} outcome
 * @param {string} nowIso
 * @returns {LoopState}
 */
export function nextState(state, outcome, nowIso) {
  if (outcome.rollbackFailed) {
    return { consecutiveFailures: state.consecutiveFailures + 1, pausedReason: 'rollback failed after a failed post-deploy smoke-check', lastCycleAt: nowIso };
  }
  if (!outcome.success) {
    const consecutiveFailures = state.consecutiveFailures + 1;
    const pausedReason = consecutiveFailures >= FAILURE_THRESHOLD ? `${consecutiveFailures} consecutive cycle failures` : null;
    return { consecutiveFailures, pausedReason, lastCycleAt: nowIso };
  }
  return { consecutiveFailures: 0, pausedReason: null, lastCycleAt: nowIso };
}

/**
 * @param {CycleOutcome} outcome
 * @returns {number}
 */
export function computeDelayMs(outcome) {
  return outcome.backlogRemaining ? MIN_INTERVAL_MS : IDLE_INTERVAL_MS;
}

/**
 * Runs one guarded cycle: skips (without invoking `claude` at all) if the `PAUSE` sentinel exists or the
 * loaded state already carries a `pausedReason`; otherwise invokes `runClaude()`, parses its outcome,
 * persists the updated state, and reports the delay before the next cycle.
 *
 * @param {{
 *   statePath: string,
 *   pausePath: string,
 *   runClaude: () => Promise<{ stdout: string }>,
 *   now?: () => string,
 *   fsDeps?: Parameters<typeof readState>[1] & Parameters<typeof writeState>[1] & Parameters<typeof isPaused>[1],
 * }} options
 * @returns {Promise<{ ran: boolean, reason?: string, outcome?: CycleOutcome, state: LoopState, delayMs: number | null }>}
 */
export async function runCycleOnce(options) {
  const { statePath, pausePath, runClaude, now = () => new Date().toISOString(), fsDeps = {} } = options;

  const state = readState(statePath, fsDeps);
  if (isPaused(pausePath, fsDeps) || state.pausedReason) {
    return { ran: false, reason: state.pausedReason ?? 'PAUSE sentinel present', state, delayMs: null };
  }

  // `runClaude()` rejecting (e.g. the `claude` binary missing, a bad --settings path) must degrade to a
  // safe "failure" outcome, not crash the driver -- an uncaught rejection here would skip writeState
  // entirely, so consecutiveFailures would never increment and the circuit breaker could never trip,
  // producing an unbounded restart-loop instead of a pause.
  let outcome;
  try {
    const { stdout } = await runClaude();
    outcome = parseCycleOutcome(stdout);
  } catch (error) {
    outcome = { success: false, backlogRemaining: false, rollbackFailed: false, raw: { error: error instanceof Error ? error.message : String(error) } };
  }
  const updated = nextState(state, outcome, now());
  writeState(statePath, updated, fsDeps);

  return { ran: true, outcome, state: updated, delayMs: updated.pausedReason ? null : computeDelayMs(outcome) };
}
