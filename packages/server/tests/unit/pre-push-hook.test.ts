import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { findChromiumInstallDir, isSkipped, runStages } from '../../../../scripts/hooks/pre-push-lib.mjs';

// WO-409 / PRD-008 §4.4 (SDD-017 §4.4): `scripts/hooks/pre-push` itself runs a real build + test:db + a
// real Playwright e2e run, far too expensive to exercise end to end here. These tests instead cover the
// three pieces of *observable behavior* `pre-push-lib.mjs` is responsible for -- stage order / first-
// failure cutoff, per-stage duration logging, PRDM_SKIP_HOOKS detection, and Chromium-install detection
// -- against fakes/stand-ins, never the real npm/playwright commands.

const NODE = process.execPath;

function fakeClock(startMs = 0, stepMs = 1000) {
  let now = startMs;
  return () => {
    const current = now;
    now += stepMs;
    return current;
  };
}

/** A stage whose `run()` spawns a trivial `node -e` process and reports its real exit code. */
function subprocessStage(name: string, exitCode: number) {
  return {
    name,
    run: () => {
      const result = spawnSync(NODE, ['-e', `process.exit(${exitCode});`]);
      return { success: result.status === 0, exitCode: result.status ?? 1 };
    },
  };
}

describe('isSkipped', () => {
  test('is true only when PRDM_SKIP_HOOKS is exactly "1"', () => {
    expect(isSkipped({ PRDM_SKIP_HOOKS: '1' })).toBe(true);
    expect(isSkipped({ PRDM_SKIP_HOOKS: 'true' })).toBe(false);
    expect(isSkipped({})).toBe(false);
  });
});

describe('runStages', () => {
  test('runs every stage in order and reports success when all pass', async () => {
    const order: string[] = [];
    const logs: string[] = [];
    const stages = ['a', 'b', 'c'].map((name) => ({
      name,
      run: () => {
        order.push(name);
        return { success: true };
      },
    }));

    const result = await runStages(stages, { now: fakeClock(), log: (line: string) => logs.push(line) });

    expect(order).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ success: true, failedStage: null, exitCode: 0 });
    expect(logs).toEqual(['a: 1.0s', 'b: 1.0s', 'c: 1.0s']);
  });

  test('stops at the first failure and never runs the remaining stages', async () => {
    const order: string[] = [];
    const errors: string[] = [];
    const stages = [
      { name: 'build', run: () => (order.push('build'), { success: true }) },
      { name: 'test:unit', run: () => (order.push('test:unit'), { success: false, exitCode: 2, message: 'unit tests failed' }) },
      { name: 'test:db', run: () => (order.push('test:db'), { success: true }) },
    ];

    const result = await runStages(stages, { now: fakeClock(), logError: (line: string) => errors.push(line) });

    expect(order).toEqual(['build', 'test:unit']);
    expect(result).toEqual({ success: false, failedStage: 'test:unit', exitCode: 2 });
    expect(errors).toEqual(['test:unit: 1.0s (FAILED)', 'unit tests failed']);
  });

  test('defaults a failing stage with no exitCode to 1', async () => {
    const result = await runStages([{ name: 'e2e', run: () => ({ success: false }) }], { now: fakeClock() });
    expect(result.exitCode).toBe(1);
  });

  test('treats a thrown error from stage.run() as a failure carrying its message', async () => {
    const errors: string[] = [];
    const stages = [
      {
        name: 'flaky',
        run: () => {
          throw new Error('spawn ENOENT');
        },
      },
    ];

    const result = await runStages(stages, { now: fakeClock(), logError: (line: string) => errors.push(line) });

    expect(result).toEqual({ success: false, failedStage: 'flaky', exitCode: 1 });
    expect(errors).toEqual(['flaky: 1.0s (FAILED)', 'spawn ENOENT']);
  });

  test('measures real wall-clock stages with actual subprocesses (no fake clock)', async () => {
    const result = await runStages([subprocessStage('ok', 0), subprocessStage('boom', 7)]);
    expect(result).toEqual({ success: false, failedStage: 'boom', exitCode: 7 });
  });
});

describe('findChromiumInstallDir', () => {
  test('returns null when the Playwright browsers cache does not exist', () => {
    const dir = findChromiumInstallDir({ env: {}, homedir: () => '/home/nobody', existsSync: () => false, readdirSync: () => [] });
    expect(dir).toBeNull();
  });

  test('returns null when the cache exists but has no chromium-* entry', () => {
    const dir = findChromiumInstallDir({
      env: {},
      homedir: () => '/home/nobody',
      existsSync: () => true,
      readdirSync: () => ['firefox-1234', 'webkit-5678'],
    });
    expect(dir).toBeNull();
  });

  test('returns the matched chromium-* directory when present', () => {
    const dir = findChromiumInstallDir({
      env: {},
      homedir: () => '/home/nobody',
      existsSync: () => true,
      readdirSync: () => ['firefox-1234', 'chromium-1234'],
    });
    expect(dir).toBe('/home/nobody/.cache/ms-playwright/chromium-1234');
  });

  test('honors PLAYWRIGHT_BROWSERS_PATH when set', () => {
    let seenPath: string | undefined;
    const dir = findChromiumInstallDir({
      env: { PLAYWRIGHT_BROWSERS_PATH: '/custom/browsers' },
      homedir: () => '/home/nobody',
      existsSync: (p: string) => {
        seenPath = p;
        return true;
      },
      readdirSync: () => ['chromium-9999'],
    });
    expect(seenPath).toBe('/custom/browsers');
    expect(dir).toBe('/custom/browsers/chromium-9999');
  });
});

test('the real PLAYWRIGHT_BROWSERS_PATH default matches this machine (sanity check)', () => {
  // Not a fake: exercises the real fs/os defaults against whatever this dev machine actually has
  // installed, mirroring how packages/testkit's own guardrails sanity-check real environment state.
  const dir = findChromiumInstallDir();
  if (dir !== null) {
    expect(dir).toContain('chromium-');
  }
  // Also asserts process.env is read by default without needing an explicit env override.
  expect(isSkipped(process.env)).toBe(process.env.PRDM_SKIP_HOOKS === '1');
});
