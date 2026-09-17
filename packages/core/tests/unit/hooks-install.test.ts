/**
 * WO-410 (PRD-008 §4.5 / SDD-017 §4.5): the pure install logic of `scripts/hooks/install.mjs`, against a
 * disposable fixture directory rather than this repo's own `.git/hooks` — installing a real, executing
 * pre-commit hook into *this* repository's working tree as a side effect of a test would intercept every
 * other commit made against it for the rest of the process's life, including work happening concurrently
 * in the same tree.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
// eslint-disable-next-line -- scripts/hooks/install.mjs lives outside any package's src on purpose (WO-410 doc comment).
import { installOne, nodeVersionWarning, planInstall, wrapperContent } from '../../../../scripts/hooks/install.mjs';

describe('scripts/hooks/install.mjs', () => {
  let hooksDir: string;

  beforeEach(() => {
    hooksDir = mkdtempSync(join(tmpdir(), 'prdm-hooks-install-'));
  });

  afterEach(() => {
    rmSync(hooksDir, { recursive: true, force: true });
  });

  test('wrapperContent delegates to the versioned script by kind', () => {
    expect(wrapperContent('pre-commit')).toContain('scripts/hooks/pre-commit');
    expect(wrapperContent('pre-push')).toContain('scripts/hooks/pre-push');
    expect(wrapperContent('pre-commit')).toMatch(/^#!\/bin\/sh/);
  });

  test('installOne writes a fresh wrapper when the hook file does not exist yet', () => {
    const result = installOne(hooksDir, 'pre-commit');
    expect(result.status).toBe('installed');
    expect(readFileSync(join(hooksDir, 'pre-commit'), 'utf8')).toBe(wrapperContent('pre-commit'));
    expect(statSync(join(hooksDir, 'pre-commit')).mode & 0o777).toBe(0o755);
  });

  test('planInstall installs both hook kinds', () => {
    const results = planInstall(hooksDir);
    expect(results.map((r) => r.kind)).toEqual(['pre-commit', 'pre-push']);
    expect(results.every((r) => r.status === 'installed')).toBe(true);
  });

  test('re-running installOne on an already-installed wrapper is a no-op (idempotent)', () => {
    installOne(hooksDir, 'pre-commit');
    const second = installOne(hooksDir, 'pre-commit');
    expect(second.status).toBe('unchanged');
  });

  test('refuses to overwrite a pre-existing hook that is not the prdm wrapper', () => {
    writeFileSync(join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "some other tool own hook"\n', 'utf8');
    const result = installOne(hooksDir, 'pre-commit');
    expect(result.status).toBe('refused');
    expect(result.message).toContain('already exists');
    // Never overwritten.
    expect(readFileSync(join(hooksDir, 'pre-commit'), 'utf8')).toContain('some other tool own hook');
  });

  test('refuses to write through a symlinked hook path', () => {
    const target = join(hooksDir, 'elsewhere.sh');
    writeFileSync(target, '#!/bin/sh\necho elsewhere\n', 'utf8');
    symlinkSync(target, join(hooksDir, 'pre-push'));
    const result = installOne(hooksDir, 'pre-push');
    expect(result.status).toBe('refused');
    expect(result.message).toContain('symlink');
  });

  test('nodeVersionWarning is null on Node >=24 and non-null below it', () => {
    expect(nodeVersionWarning('24.21.0')).toBeNull();
    expect(nodeVersionWarning('26.0.0')).toBeNull();
    expect(nodeVersionWarning('20.20.2')).toMatch(/Node 20\.20\.2/);
  });
});
