import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { describe, expect, test, vi } from 'vitest';
import type { StartGuardResult } from '../../../../scripts/rsi/start-guard.d.mts';
import { buildDeployStages, guardAndDeploy, runDeploy, SERVICE_NAME } from '../../scripts/deploy.mjs';

function guardResult(overrides: Partial<StartGuardResult> = {}): StartGuardResult {
  return {
    ok: false,
    expectedBranch: 'main',
    currentBranch: 'main',
    dirtyFiles: [],
    unpushedCount: 0,
    hasUpstream: true,
    problems: [],
    warnings: [],
    ...overrides,
  };
}

// WO-584 / SDD-057: `deploy.mjs` reuses `runStages` (already covered by pre-push-hook.test.ts) to run
// build:server -> build:app -> restart in order, stopping at the first failure. These tests exercise
// that composition against trivial `node -e` stand-ins, never a real build or `systemctl` restart.

const NODE = process.execPath;

function stage(name: string, exitCode: number) {
  return {
    name,
    run: () => {
      const result = spawnSync(NODE, ['-e', `process.exit(${exitCode});`]);
      return { success: result.status === 0, exitCode: result.status ?? 1 };
    },
  };
}

describe('buildDeployStages', () => {
  test('orders build:server, build:app, then restart against the systemd unit name', () => {
    const stages = buildDeployStages();
    expect(stages.map((s) => s.name)).toEqual(['build:server', 'build:app', 'restart']);
    expect(SERVICE_NAME).toBe('prdmanager-server.service');
  });
});

describe('runDeploy', () => {
  test('succeeds when every stage succeeds', async () => {
    const result = await runDeploy({ stages: [stage('build:server', 0), stage('build:app', 0), stage('restart', 0)] });
    expect(result).toEqual({ success: true, failedStage: null, exitCode: 0 });
  });

  test('stops at the first failing stage and reports it', async () => {
    const restart = stage('restart', 0);
    const result = await runDeploy({ stages: [stage('build:server', 0), stage('build:app', 7), restart] });
    expect(result).toEqual({ success: false, failedStage: 'build:app', exitCode: 7 });
  });
});

// WO-610 / SDD-063: la guarda de partida reproducible corta antes de cualquier build/restart.
describe('guardAndDeploy', () => {
  const log = { warn() {}, error() {} };

  test('aborts without running any stage when the guard fails', async () => {
    const deploy = vi.fn();
    const result = await guardAndDeploy({
      enforceGuard: () => guardResult({ problems: ['working tree is not clean'] }),
      deploy,
      log,
    });
    expect(deploy).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, failedStage: 'start-guard', exitCode: 1 });
  });

  test('runs the deploy when the guard passes', async () => {
    const deploy = vi.fn(async () => ({ success: true, failedStage: null, exitCode: 0 }));
    const result = await guardAndDeploy({
      enforceGuard: () => guardResult({ ok: true }),
      deploy,
      log,
    });
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
