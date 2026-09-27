import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { isValidSha, runRollback } from '../../scripts/rollback.mjs';

// WO-585 / SDD-057: `rollback.mjs` must always go through `git revert` (a real, hook-gated commit),
// never `git reset --hard`/`checkout` -- these tests exercise the stage composition and sha validation
// against trivial `node -e` stand-ins, never a real revert or deploy.

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

describe('runRollback', () => {
  test('succeeds when every provided stage succeeds', async () => {
    const result = await runRollback('abc1234', { stages: [stage('revert', 0), stage('build:server', 0)] });
    expect(result).toEqual({ success: true, failedStage: null, exitCode: 0 });
  });

  test('stops at the first failing stage and reports it', async () => {
    const result = await runRollback('abc1234', { stages: [stage('revert', 3), stage('build:server', 0)] });
    expect(result).toEqual({ success: false, failedStage: 'revert', exitCode: 3 });
  });

  test('rejects a malformed sha before ever calling git, without needing an override stage', async () => {
    const result = await runRollback('not a sha; rm -rf /');
    expect(result.success).toBe(false);
    expect(result.failedStage).toBe('revert');
  });

  test('rejects a malformed sha even when the caller supplies its own stages, never bypassing validation', async () => {
    const result = await runRollback('not-a-sha', { stages: [stage('revert', 0)] });
    expect(result).toEqual({ success: false, failedStage: 'revert', exitCode: 1 });
  });
});

describe('isValidSha', () => {
  test.each([
    ['abc1234', true, '7 hex chars, the minimum accepted'],
    ['a'.repeat(40), true, '40 hex chars, the maximum (full sha)'],
    ['abc123', false, '6 hex chars, one below the minimum'],
    [`${'a'.repeat(40)}f`, false, '41 hex chars, one above the maximum'],
    ['ABC1234', false, 'uppercase hex is rejected'],
    ['', false, 'empty string'],
    ['-abc1234', false, 'leading dash, which could be mistaken for a git flag'],
    ['not a sha; rm -rf /', false, 'shell metacharacters'],
  ])('%s -> %s (%s)', (value, expected) => {
    expect(isValidSha(value)).toBe(expected);
  });
});
