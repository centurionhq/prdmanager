/**
 * PRD-008 §4.4 (WO-409): orchestration logic for `scripts/hooks/pre-push`, pulled into its own module so
 * it can be exercised by `packages/server/tests/unit/pre-push-hook.test.ts` without ever running the real
 * (expensive) build/test/e2e stages. Every function here takes its side-effecting dependencies (env,
 * clock, logger, filesystem) as injectable parameters defaulting to the real ones, so the tests can pass
 * fakes instead of monkey-patching globals.
 *
 * `runStages` itself never touches `child_process`: each `Stage.run()` is supplied by the caller
 * (`scripts/hooks/pre-push` wires up the real `npm run <script>` / `npx playwright` commands), so this
 * module stays a pure orchestrator -- order, first-failure cutoff, and duration measurement/formatting --
 * regardless of what a stage actually does.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {object} StageOutcome
 * @property {boolean} success
 * @property {number} [exitCode] - Process exit code to propagate when `success` is false (default 1).
 * @property {string} [message] - Extra context to print (e.g. a spawn error, or a Chromium-missing hint).
 */

/**
 * @typedef {object} Stage
 * @property {string} name
 * @property {() => (StageOutcome | Promise<StageOutcome>)} run
 */

/**
 * @typedef {object} RunStagesResult
 * @property {boolean} success
 * @property {string | null} failedStage
 * @property {number} exitCode
 */

/**
 * `PRDM_SKIP_HOOKS=1` bypasses pre-commit/pre-push repo-wide (same variable the `commit-msg` hook and
 * `scripts/hooks/install.mjs`'s generated wrappers already document).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isSkipped(env = process.env) {
  return env.PRDM_SKIP_HOOKS === '1';
}

/**
 * Runs `stages` in order, stopping at the first failure. Prints `"<name>: <duration>s"` for every stage
 * that starts (whether it passes or fails), via the injectable `log`/`logError`, using `now()` (default
 * `Date.now`) to measure wall-clock duration -- swapped out in tests for a fake, deterministic clock.
 *
 * @param {Stage[]} stages
 * @param {{ now?: () => number, log?: (line: string) => void, logError?: (line: string) => void }} [options]
 * @returns {Promise<RunStagesResult>}
 */
export async function runStages(stages, options = {}) {
  const { now = () => Date.now(), log = console.log, logError = console.error } = options;

  for (const stage of stages) {
    const startedAt = now();
    /** @type {StageOutcome} */
    let outcome;
    try {
      outcome = await stage.run();
    } catch (error) {
      outcome = { success: false, message: error instanceof Error ? error.message : String(error) };
    }
    const durationSeconds = ((now() - startedAt) / 1000).toFixed(1);

    if (outcome.success) {
      log(`${stage.name}: ${durationSeconds}s`);
      continue;
    }

    logError(`${stage.name}: ${durationSeconds}s (FAILED)`);
    if (outcome.message) logError(outcome.message);
    return { success: false, failedStage: stage.name, exitCode: outcome.exitCode ?? 1 };
  }

  return { success: true, failedStage: null, exitCode: 0 };
}

/**
 * Detects whether Playwright's Chromium build is installed, without ever shelling out or importing
 * `@playwright/test` -- just a filesystem check for a `chromium-*` directory under Playwright's browser
 * cache (`PLAYWRIGHT_BROWSERS_PATH` if set, else `~/.cache/ms-playwright`, Playwright's own default on
 * Linux/macOS). Returns the matched directory's absolute path, or `null` if Chromium isn't installed
 * there -- the caller is expected to print the exact fix (`npx playwright install chromium`) itself
 * rather than let Playwright fail mid-run with a much less actionable stack trace.
 *
 * @param {{ env?: NodeJS.ProcessEnv, homedir?: () => string, existsSync?: (p: string) => boolean, readdirSync?: (p: string) => string[] }} [options]
 * @returns {string | null}
 */
export function findChromiumInstallDir(options = {}) {
  const { env = process.env, homedir = os.homedir, existsSync = fs.existsSync, readdirSync = fs.readdirSync } = options;

  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  const browsersDir = override ? override : path.join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(browsersDir)) return null;

  const match = readdirSync(browsersDir).find((entry) => entry.startsWith('chromium-'));
  return match ? path.join(browsersDir, match) : null;
}
