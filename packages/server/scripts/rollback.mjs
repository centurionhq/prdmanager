#!/usr/bin/env node
/**
 * WO-585 / SDD-057: reverts a bad commit on `main` and redeploys, for the RSI loop's post-deploy
 * smoke-check failure path (`scripts/rsi/driver.mjs`). Always `git revert --no-edit <sha>`, never `git
 * reset --hard`/`checkout` -- a revert is itself a normal commit that goes through the same
 * pre-commit/pre-push hooks as any other change (SDD-057 "Diseño"), so a rollback can never be a way to
 * bypass the real quality gate. Reuses `deploy.mjs`'s `runDeploy` for the rebuild+restart step instead of
 * duplicating it.
 */
import process from 'node:process';
import { runStages } from '../../../scripts/hooks/pre-push-lib.mjs';
import { isEntryPoint } from '../../../scripts/entry-point.mjs';
import { buildDeployStages } from './deploy.mjs';
import { spawnStage } from './spawn-stage.mjs';

export const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/** @param {string} sha @returns {boolean} */
export function isValidSha(sha) {
  return typeof sha === 'string' && SHA_PATTERN.test(sha);
}

/**
 * @param {string} sha - the last-known-bad commit sha to revert before redeploying
 * @param {{ stages?: import('../../../scripts/hooks/pre-push-lib.mjs').Stage[] }} [options]
 * @returns {Promise<import('../../../scripts/hooks/pre-push-lib.mjs').RunStagesResult>}
 */
export async function runRollback(sha, options = {}) {
  // Validated unconditionally, before any stage list (default or caller-supplied) is even considered --
  // a malformed sha must never reach `git revert` regardless of how the stages were assembled.
  if (!isValidSha(sha)) return { success: false, failedStage: 'revert', exitCode: 1 };
  const stages = options.stages ?? [spawnStage('revert', 'git', ['revert', '--no-edit', sha]), ...buildDeployStages()];
  return runStages(stages);
}

if (isEntryPoint(import.meta.url)) {
  const sha = process.argv[2];
  if (!sha) {
    console.error('usage: rollback.mjs <commit-sha>');
    process.exitCode = 1;
  } else {
    const result = await runRollback(sha);
    process.exitCode = result.exitCode;
  }
}
