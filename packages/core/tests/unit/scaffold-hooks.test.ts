import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import { installHooks, planHookFile, resolveHooksDir } from '../../src/scaffold/hooks.js';
import { git, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

const run = promisify(execFile);
const PROJECT_ID = 'prj_0123456789abcdef';

let root = '';
afterEach(() => root && removeDir(root));

describe('resolveHooksDir', () => {
  test('defaults to .git/hooks', async () => {
    root = makeTmpDir();
    gitInit(root);
    expect(await resolveHooksDir(root)).toBe(join(root, '.git', 'hooks'));
  });

  test('honors core.hooksPath (e.g. husky)', async () => {
    root = makeTmpDir();
    gitInit(root);
    git(root, 'config', 'core.hooksPath', '.husky');
    expect(await resolveHooksDir(root)).toBe(join(root, '.husky'));
  });
});

describe('installHooks', () => {
  test('fresh install writes executable post-commit and commit-msg hooks', async () => {
    root = makeTmpDir();
    gitInit(root);
    const result = await installHooks(root, PROJECT_ID);
    expect(result.installed).toHaveLength(2);
    for (const path of result.installed) {
      expect(statSync(path).mode & 0o777).toBe(0o755);
      expect(readFileSync(path, 'utf8')).toContain(`# >>> prdm ${PROJECT_ID} >>>`);
    }
    expect(readFileSync(join(root, '.git', 'hooks', 'commit-msg'), 'utf8')).toContain('check commit-msg');
    expect(readFileSync(join(root, '.git', 'hooks', 'post-commit'), 'utf8')).toContain('prdm_run sync');
  });

  test('re-running reports both hooks unchanged', async () => {
    root = makeTmpDir();
    gitInit(root);
    await installHooks(root, PROJECT_ID);
    const second = await installHooks(root, PROJECT_ID);
    expect(second.installed).toEqual([]);
    expect(second.unchanged).toHaveLength(2);
  });

  test('preserves an existing sh hook and appends the prdm block', async () => {
    root = makeTmpDir();
    gitInit(root);
    const path = join(root, '.git', 'hooks', 'post-commit');
    writeFileSync(path, '#!/bin/sh\necho custom-hook\n');
    await installHooks(root, PROJECT_ID);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('echo custom-hook');
    expect(content).toContain(`# >>> prdm ${PROJECT_ID} >>>`);
    expect(content.indexOf('echo custom-hook')).toBeLessThan(content.indexOf('# >>> prdm'));
  });

  test('migrates the legacy PRD-001 post-commit body into the marker block instead of appending after it', async () => {
    root = makeTmpDir();
    gitInit(root);
    const path = join(root, '.git', 'hooks', 'post-commit');
    writeFileSync(path, '#!/bin/sh\nnpm run --silent prdm -- sync || true\n');
    await installHooks(root, PROJECT_ID);
    const content = readFileSync(path, 'utf8');
    expect(content).not.toContain('npm run --silent prdm -- sync || true\n\n');
    expect((content.match(/prdm_run sync/g) ?? []).length).toBe(1);
  });

  test('refuses a hook with an unrecognized shebang unless --force', async () => {
    root = makeTmpDir();
    gitInit(root);
    const path = join(root, '.git', 'hooks', 'post-commit');
    writeFileSync(path, '#!/usr/bin/env python3\nprint("x")\n');
    await expect(installHooks(root, PROJECT_ID)).rejects.toThrow(/unrecognized shebang/);
    const result = await installHooks(root, PROJECT_ID, { force: true });
    expect(result.installed.length).toBeGreaterThan(0);
  });

  test('writes into a custom core.hooksPath directory (e.g. .husky)', async () => {
    root = makeTmpDir();
    gitInit(root);
    git(root, 'config', 'core.hooksPath', '.husky');
    await installHooks(root, PROJECT_ID);
    expect(existsSync(join(root, '.husky', 'commit-msg'))).toBe(true);
    expect(existsSync(join(root, '.git', 'hooks', 'commit-msg'))).toBe(false);
  });
});

describe('planHookFile idempotency table', () => {
  test('identical re-plan reports unchanged', () => {
    const first = planHookFile('post-commit', null, PROJECT_ID, '.', 'npx --no-install prdm');
    const second = planHookFile('post-commit', first.content, PROJECT_ID, '.', 'npx --no-install prdm');
    expect(second.changed).toBe(false);
  });

  test('the hook computes the project root at run time via git rev-parse --show-toplevel, never a baked-in absolute path (WO-024 finding 4)', () => {
    const plan = planHookFile('post-commit', null, PROJECT_ID, '.', 'npx --no-install prdm');
    expect(plan.content).toContain('git rev-parse --show-toplevel');
    expect(plan.content).not.toContain('/repo');
  });

  test('a relative project path (project in a repo subdirectory) is quoted and appended after the toplevel', () => {
    const plan = planHookFile('post-commit', null, PROJECT_ID, 'packages/app', 'npx --no-install prdm');
    expect(plan.content).toMatch(/"\$prdm_toplevel"\/'packages\/app'/);
  });

  test("re-planning over an existing block with a relative path containing $' and $& does not corrupt the output (WO-024 finding 4)", () => {
    const dangerous = "weird$'project$&name";
    const first = planHookFile('post-commit', null, PROJECT_ID, dangerous, 'npx --no-install prdm');
    // Re-plan against the just-generated content: this exercises the regex-replace upsert path, where a naive
    // `String.replace(re, newBlock)` would treat `$&`/`$'` in `newBlock` as replacement-pattern syntax.
    const second = planHookFile('post-commit', first.content, PROJECT_ID, dangerous, 'npx --no-install prdm');
    expect(second.content).toBe(first.content);
    expect(second.changed).toBe(false);
  });
});

describe('WO-024 finding 4: refusing to write through a symlinked hook file', () => {
  let root = '';
  afterEach(() => root && removeDir(root));

  test('installHooks refuses when the target hook path is a symlink', async () => {
    root = makeTmpDir();
    gitInit(root);
    const elsewhere = join(root, 'elsewhere.sh');
    writeFileSync(elsewhere, '#!/bin/sh\necho pwned\n');
    symlinkSync(elsewhere, join(root, '.git', 'hooks', 'post-commit'));
    await expect(installHooks(root, PROJECT_ID)).rejects.toThrow(/symlink/);
  });
});

describe('WO-024 finding 4: hooks in a linked git worktree', () => {
  let root = '';
  let worktree = '';
  afterEach(() => {
    if (root) removeDir(root);
    if (worktree) removeDir(worktree);
  });

  test('a commit in a linked worktree evaluates the worktree, not the original checkout it was installed from', async () => {
    root = makeTmpDir();
    gitInit(root);
    const projectFile = (enforceRefs: boolean): string =>
      [
        'version: 1',
        'project:',
        '  id: prj_0123456789abcdef',
        '  name: fixture',
        'git:',
        `  enforce_refs: ${enforceRefs}`,
        '',
      ].join('\n');
    writeFiles(root, { '.prdm.yaml': projectFile(true), 'README.md': 'a\n' });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'chore: init');

    await installHooks(root, PROJECT_ID);

    worktree = `${root}-wt`;
    git(root, 'worktree', 'add', '-q', '-b', 'wt-branch', worktree);
    // The worktree's own .prdm.yaml disables enforcement: only reading *this* worktree's file, at commit time,
    // proves the hook did not `cd` back into the original checkout it was installed from.
    writeFiles(worktree, { '.prdm.yaml': projectFile(false), 'src/a.ts': 'export const a = 1;\n' });
    git(worktree, 'add', '-A');

    const prdmStub = join(worktree, 'prdm-stub.sh');
    const logPath = join(worktree, 'prdm-stub.log');
    writeFileSync(prdmStub, `#!/bin/sh\necho "$(pwd)|$*" >> ${JSON.stringify(logPath)}\n`);
    const run = promisify(execFile);
    await run('chmod', ['+x', prdmStub]);

    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'feat: add a, no refs'], {
      cwd: worktree,
      env: { ...process.env, PRDM_BIN: prdmStub },
    });

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const syncLine = lines.find((line) => line.endsWith('|sync'));
    expect(syncLine).toBeDefined();
    const [pwd] = (syncLine ?? '').split('|');
    expect(pwd).toBe(worktree);
  });
});

describe('quoting a project root with spaces and quotes', () => {
  test('the installed hooks execute correctly when the root path contains a space and a single quote', async () => {
    root = makeTmpDir();
    const projectRoot = join(root, "it's a project");
    mkdirSync(projectRoot, { recursive: true });
    gitInit(projectRoot);

    await installHooks(projectRoot, PROJECT_ID);
    const postCommit = join(projectRoot, '.git', 'hooks', 'post-commit');
    // Hooks are always invoked by git with cwd inside the work tree (never the parent directory): a real hook's
    // `git rev-parse --show-toplevel` call requires this.
    const { stdout } = await run('sh', [postCommit], { cwd: projectRoot, env: { ...process.env, PRDM_BIN: 'true' } });
    expect(stdout).toBe('');

    writeFiles(projectRoot, { 'msg dir/COMMIT_EDITMSG': 'feat: x\n' });
    const commitMsg = join(projectRoot, '.git', 'hooks', 'commit-msg');
    await run('sh', [commitMsg, 'msg dir/COMMIT_EDITMSG'], { cwd: projectRoot, env: { ...process.env, PRDM_BIN: 'true' } });
  });
});
