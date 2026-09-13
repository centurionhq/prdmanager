import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
    const first = planHookFile('post-commit', null, PROJECT_ID, '/repo', 'npx --no-install prdm');
    const second = planHookFile('post-commit', first.content, PROJECT_ID, '/repo', 'npx --no-install prdm');
    expect(second.changed).toBe(false);
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
    const { stdout } = await run('sh', [postCommit], { cwd: root, env: { ...process.env, PRDM_BIN: 'true' } });
    expect(stdout).toBe('');

    writeFiles(root, { 'msg dir/COMMIT_EDITMSG': 'feat: x\n' });
    const commitMsg = join(projectRoot, '.git', 'hooks', 'commit-msg');
    await run('sh', [commitMsg, 'msg dir/COMMIT_EDITMSG'], { cwd: root, env: { ...process.env, PRDM_BIN: 'true' } });
  });
});
