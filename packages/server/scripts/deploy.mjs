#!/usr/bin/env node
/**
 * WO-584 / SDD-057: rebuilds `@prdm/server` + `@prdm/app` and restarts the systemd `--user` unit that
 * supervises `packages/server` (see `packages/server/deploy/systemd/prdmanager-server.service.template`),
 * mirroring the same two build steps `packages/server/Dockerfile` already runs. Reuses
 * `scripts/hooks/pre-push-lib.mjs`'s `runStages` for the same first-failure-cutoff/duration-logging
 * orchestration the git hooks already use, instead of a new bespoke runner.
 *
 * `buildDeployStages`/`runDeploy` take their stages as an injectable parameter (defaulting to the real
 * npm/systemctl commands), so `packages/server/tests/unit/deploy-script.test.ts` can exercise ordering
 * and failure handling against trivial `node -e` stand-ins instead of a real build + service restart.
 */
import process from 'node:process';
import { runStages } from '../../../scripts/hooks/pre-push-lib.mjs';
import { isEntryPoint } from '../../../scripts/entry-point.mjs';
import { enforceStartGuard } from '../../../scripts/rsi/start-guard.mjs';
import { REPO_ROOT } from './repo-root.mjs';
import { spawnStage } from './spawn-stage.mjs';

export const SERVICE_NAME = 'prdmanager-server.service';

/** @returns {import('../../../scripts/hooks/pre-push-lib.mjs').Stage[]} */
export function buildDeployStages() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return [
    spawnStage('build:server', npmBin, ['run', 'build']),
    spawnStage('build:app', npmBin, ['run', 'build', '--workspace=@prdm/app']),
    spawnStage('restart', 'systemctl', ['--user', 'restart', SERVICE_NAME]),
  ];
}

/**
 * @param {{ stages?: import('../../../scripts/hooks/pre-push-lib.mjs').Stage[] }} [options]
 * @returns {Promise<import('../../../scripts/hooks/pre-push-lib.mjs').RunStagesResult>}
 */
export async function runDeploy(options = {}) {
  const stages = options.stages ?? buildDeployStages();
  return runStages(stages);
}

/**
 * WO-610 / SDD-063: aborta sin build ni restart si el checkout no es un punto de partida reproducible.
 * `enforceGuard` es inyectable para que los tests no dependan del estado git del worktree.
 * @param {{ enforceGuard?: () => { ok: boolean }, deploy?: () => Promise<import('../../../scripts/hooks/pre-push-lib.mjs').RunStagesResult>, log?: { error: (line: string) => void } }} [options]
 */
export async function guardAndDeploy(options = {}) {
  const { enforceGuard = () => enforceStartGuard({ cwd: REPO_ROOT }), deploy = runDeploy, log = console } = options;
  const guard = enforceGuard();
  if (!guard.ok) {
    log.error('deploy: aborted by the reproducible-start guard -- no build, no restart.');
    return { success: false, failedStage: 'start-guard', exitCode: 1 };
  }
  return deploy();
}

if (isEntryPoint(import.meta.url)) {
  const result = await guardAndDeploy();
  process.exitCode = result.exitCode;
}
