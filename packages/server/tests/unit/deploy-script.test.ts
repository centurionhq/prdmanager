import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { buildDeployStages, runDeploy, SERVICE_NAME } from '../../scripts/deploy.mjs';

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
