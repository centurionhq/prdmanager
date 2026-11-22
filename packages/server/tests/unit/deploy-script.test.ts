import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, test, vi } from 'vitest';
import type { StartGuardResult } from '../../../../scripts/rsi/start-guard.d.mts';
import {
  buildDeployStages,
  buildRestartStage,
  buildVerifyStage,
  guardAndDeploy,
  runDeploy,
  SERVICE_NAME,
  type SystemctlRun,
} from '../../scripts/deploy.mjs';
import { SERVICE_TEMPLATE_DIR } from '../../scripts/service-unit.mjs';

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

/** systemctl falso: `show` devuelve `pid`, `is-active` devuelve `active`; registra las llamadas. */
function fakeSystemctl(active: string, pid: number, calls: string[][] = []): SystemctlRun {
  return (args) => {
    calls.push(args);
    if (args.includes('show')) return { status: 0, stdout: `${pid}\n`, stderr: '' };
    if (args.includes('is-active')) return { status: active === 'active' ? 0 : 3, stdout: `${active}\n`, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
}

describe('buildDeployStages', () => {
  test('orders build:server, build:app, restart, verify', () => {
    const stages = buildDeployStages({ systemctl: fakeSystemctl('active', 1) });
    expect(stages.map((s) => s.name)).toEqual(['build:server', 'build:app', 'restart', 'verify']);
  });

  test('SERVICE_NAME is derived from the repo unit template', () => {
    const templates = readdirSync(SERVICE_TEMPLATE_DIR).filter((f) => f.endsWith('.service.template'));
    expect(SERVICE_NAME).toBe(templates[0]!.replace(/\.template$/, ''));
    expect(SERVICE_NAME).toBe('prdm-server.service');
  });

  test('the rsi unit orders itself After= the server unit', () => {
    const rsi = readFileSync(join(SERVICE_TEMPLATE_DIR, '../../../../scripts/rsi/systemd/prdmanager-rsi.service.template'), 'utf8');
    const after = /^After=(.*)$/m.exec(rsi)?.[1] ?? '';
    expect(after.split(/\s+/)).toContain(SERVICE_NAME);
  });
});

describe('buildRestartStage', () => {
  test('records the previous MainPID and restarts the unit', async () => {
    const calls: string[][] = [];
    const unitState: { previousMainPid?: number } = {};
    const result = await buildRestartStage({ systemctl: fakeSystemctl('active', 111, calls), unitState }).run();
    expect(result.success).toBe(true);
    expect(calls).toContainEqual(['--user', 'restart', 'prdm-server.service']);
    expect(unitState.previousMainPid).toBe(111);
  });

  test('fails with the unit name when systemctl restart fails', async () => {
    const systemctl: SystemctlRun = (args) =>
      args.includes('restart') ? { status: 5, stdout: '', stderr: 'not found' } : { status: 0, stdout: '1', stderr: '' };
    const result = await buildRestartStage({ systemctl }).run();
    expect(result).toMatchObject({ success: false, exitCode: 5 });
    expect(result.message).toContain('restart failed for prdm-server.service: not found');
  });
});

describe('buildVerifyStage', () => {
  const sleep = async () => {};
  const verify = (active: string, pid: number) =>
    buildVerifyStage({ systemctl: fakeSystemctl(active, pid), unitState: { previousMainPid: 111 }, attempts: 1, sleep }).run();

  test('succeeds when active with a new MainPID', async () => {
    expect((await verify('active', 222)).success).toBe(true);
  });

  test('fails when MainPID did not change, naming the unit and pids', async () => {
    const result = await verify('active', 111);
    expect(result.success).toBe(false);
    expect(result.message).toContain('prdm-server.service');
    expect(result.message).toContain('MainPID=111');
    expect(result.message).toContain('before restart 111');
  });

  test('fails when inactive', async () => {
    expect((await verify('inactive', 222)).success).toBe(false);
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
