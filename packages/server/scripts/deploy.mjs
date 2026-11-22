#!/usr/bin/env node
/**
 * WO-584 / SDD-057: rebuilds `@prdm/server` + `@prdm/app` and restarts the systemd `--user` unit that
 * supervises `packages/server` (see `packages/server/deploy/systemd/prdm-server.service.template`),
 * mirroring the same two build steps `packages/server/Dockerfile` already runs. Reuses
 * `scripts/hooks/pre-push-lib.mjs`'s `runStages` for the same first-failure-cutoff/duration-logging
 * orchestration the git hooks already use, instead of a new bespoke runner.
 *
 * `buildDeployStages`/`runDeploy` take their stages as an injectable parameter (defaulting to the real
 * npm/systemctl commands), so `packages/server/tests/unit/deploy-script.test.ts` can exercise ordering
 * and failure handling against trivial `node -e` stand-ins instead of a real build + service restart.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { runStages } from '../../../scripts/hooks/pre-push-lib.mjs';
import { isEntryPoint } from '../../../scripts/entry-point.mjs';
import { enforceStartGuard } from '../../../scripts/rsi/start-guard.mjs';
import { REPO_ROOT } from './repo-root.mjs';
import { SERVICE_NAME } from './service-unit.mjs';
import { spawnStage } from './spawn-stage.mjs';

export { SERVICE_NAME };

/** @typedef {(args: string[]) => { status: number | null, stdout: string, stderr: string }} SystemctlRun */

/**
 * Ejecuta `systemctl <args>`. En tests siempre se inyecta un falso: ninguno debe tocar systemd.
 * @param {{ spawn?: typeof spawnSync }} [options]
 * @returns {SystemctlRun}
 */
export function systemctlRunner(options = {}) {
  const spawn = options.spawn ?? spawnSync;
  return (args) => {
    const result = spawn('systemctl', args, { cwd: REPO_ROOT, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

/** @param {string} serviceName @param {SystemctlRun} run */
export function readMainPid(serviceName, run) {
  const result = run(['--user', 'show', serviceName, '--property', 'MainPID', '--value']);
  if (result.status !== 0) return 0;
  const pid = Number.parseInt(result.stdout.trim(), 10);
  return Number.isNaN(pid) ? 0 : pid;
}

/** @param {string} serviceName @param {SystemctlRun} run */
export function readActiveState(serviceName, run) {
  const result = run(['--user', 'is-active', serviceName]);
  return result.status === null ? '' : result.stdout.trim();
}

/**
 * @param {{ serviceName?: string, systemctl?: SystemctlRun, unitState?: { previousMainPid?: number } }} [options]
 * @returns {import('../../../scripts/hooks/pre-push-lib.mjs').Stage}
 */
export function buildRestartStage({ serviceName = SERVICE_NAME, systemctl = systemctlRunner(), unitState = {} } = {}) {
  return {
    name: 'restart',
    run: () => {
      unitState.previousMainPid = readMainPid(serviceName, systemctl);
      const result = systemctl(['--user', 'restart', serviceName]);
      if (result.status !== 0) {
        return {
          success: false,
          exitCode: result.status ?? 1,
          message: `restart failed for ${serviceName}: ${result.stderr.trim()}`,
        };
      }
      return { success: true, exitCode: 0 };
    },
  };
}

/**
 * Exige `is-active` = `active` y un `MainPID` nuevo (distinto al de antes del restart).
 * @param {{ serviceName?: string, systemctl?: SystemctlRun, unitState?: { previousMainPid?: number }, attempts?: number, sleepMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {import('../../../scripts/hooks/pre-push-lib.mjs').Stage}
 */
export function buildVerifyStage({
  serviceName = SERVICE_NAME,
  systemctl = systemctlRunner(),
  unitState = {},
  attempts = 10,
  sleepMs = 300,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return {
    name: 'verify',
    run: async () => {
      const before = unitState.previousMainPid ?? 0;
      let active = '';
      let pid = 0;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        active = readActiveState(serviceName, systemctl);
        pid = readMainPid(serviceName, systemctl);
        if (active === 'active' && pid > 0 && pid !== before) return { success: true, exitCode: 0 };
        if (attempt < attempts) await sleep(sleepMs);
      }
      return {
        success: false,
        exitCode: 1,
        message: `verify failed for ${serviceName}: is-active=${active} MainPID=${pid} (before restart ${before})`,
      };
    },
  };
}

/**
 * @param {{ serviceName?: string, systemctl?: SystemctlRun }} [options]
 * @returns {import('../../../scripts/hooks/pre-push-lib.mjs').Stage[]}
 */
export function buildDeployStages(options = {}) {
  const { serviceName = SERVICE_NAME, systemctl = systemctlRunner() } = options;
  const unitState = {};
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return [
    spawnStage('build:server', npmBin, ['run', 'build']),
    spawnStage('build:app', npmBin, ['run', 'build', '--workspace=@prdm/app']),
    buildRestartStage({ serviceName, systemctl, unitState }),
    buildVerifyStage({ serviceName, systemctl, unitState }),
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
