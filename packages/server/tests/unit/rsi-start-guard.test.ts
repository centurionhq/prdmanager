import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { checkRepoStart } from '../../../../scripts/rsi/start-guard.mjs';

// WO-610 / SDD-063: guarda de partida reproducible, ejercitada contra repos git reales en tmpdir.

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'prdm-start-guard-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function initRepo(): string {
  const dir = tmp();
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'guard@test.local');
  git(dir, 'config', 'user.name', 'guard');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

function addUpstream(dir: string): void {
  const bare = tmp();
  git(bare, 'init', '--bare');
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-u', 'origin', 'main');
}

function cleanRepoWithUpstream(): string {
  const dir = initRepo();
  addUpstream(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('checkRepoStart', () => {
  test('passes on a clean checkout of main with upstream and nothing unpushed', () => {
    const dir = cleanRepoWithUpstream();
    const result = checkRepoStart({ cwd: dir, env: {} });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.dirtyFiles).toEqual([]);
    expect(result.currentBranch).toBe('main');
    expect(result.hasUpstream).toBe(true);
    expect(result.unpushedCount).toBe(0);
  });

  test('fails on a dirty tree listing both paths', () => {
    const dir = cleanRepoWithUpstream();
    writeFileSync(join(dir, 'README.md'), 'changed\n');
    writeFileSync(join(dir, 'new-file.txt'), 'x\n');
    const result = checkRepoStart({ cwd: dir, env: {} });
    expect(result.ok).toBe(false);
    expect(result.dirtyFiles).toHaveLength(2);
    expect(result.problems[0]).toContain('README.md');
    expect(result.problems[0]).toContain('new-file.txt');
  });

  test('fails when HEAD is not on the integration branch', () => {
    const dir = cleanRepoWithUpstream();
    git(dir, 'checkout', '-b', 'feature/wo-447');
    const result = checkRepoStart({ cwd: dir, env: {} });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('feature/wo-447') && p.includes('main'))).toBe(true);
  });

  test('fails when there are unpushed commits', () => {
    const dir = cleanRepoWithUpstream();
    git(dir, 'commit', '--allow-empty', '-m', 'x');
    const result = checkRepoStart({ cwd: dir, env: {} });
    expect(result.ok).toBe(false);
    expect(result.unpushedCount).toBe(1);
    expect(result.problems.some((p) => p.includes('1 commit'))).toBe(true);
  });

  test('fails when no upstream is configured', () => {
    const dir = initRepo();
    const result = checkRepoStart({ cwd: dir, env: {} });
    expect(result.ok).toBe(false);
    expect(result.hasUpstream).toBe(false);
    expect(result.problems.some((p) => p.includes('upstream'))).toBe(true);
  });

  test('fails without throwing when cwd is not a git repo', () => {
    const dir = tmp();
    const result = checkRepoStart({ cwd: dir, env: {} });
    expect(result.ok).toBe(false);
  });

  test('allowDirtyStart turns problems into warnings', () => {
    const dir = cleanRepoWithUpstream();
    writeFileSync(join(dir, 'new-file.txt'), 'x\n');
    const result = checkRepoStart({ cwd: dir, env: {}, allowDirtyStart: true });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('new-file.txt'))).toBe(true);
  });

  test('honors a custom integration branch', () => {
    const dir = cleanRepoWithUpstream();
    const result = checkRepoStart({ cwd: dir, env: {}, integrationBranch: 'release' });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('release'))).toBe(true);
  });
});
