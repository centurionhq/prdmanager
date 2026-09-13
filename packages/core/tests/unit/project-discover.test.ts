import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { discoverProjectRoot, findNestedProjectRoots } from '../../src/project/discover.js';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

describe('discoverProjectRoot', () => {
  test('walks up from a nested directory to find .prdm.yaml', () => {
    root = makeTmpDir();
    writeFiles(root, { '.prdm.yaml': 'version: 1\n', 'a/b/c/.gitkeep': '' });
    expect(discoverProjectRoot(join(root, 'a', 'b', 'c'))).toBe(root);
  });

  test('stops at the first .prdm.yaml found, ignoring any further up', () => {
    root = makeTmpDir();
    writeFiles(root, { '.prdm.yaml': 'version: 1\n', 'nested/.prdm.yaml': 'version: 1\n', 'nested/a/.gitkeep': '' });
    expect(discoverProjectRoot(join(root, 'nested', 'a'))).toBe(join(root, 'nested'));
  });

  test('PRDM_ROOT forces the root when it contains .prdm.yaml', () => {
    root = makeTmpDir();
    writeFiles(root, { '.prdm.yaml': 'version: 1\n' });
    expect(discoverProjectRoot('/does/not/matter', { PRDM_ROOT: root })).toBe(root);
  });

  test('PRDM_ROOT forces the root when it contains the legacy prdm.config.json', () => {
    root = makeTmpDir();
    writeFiles(root, { 'prdm.config.json': '{}' });
    expect(discoverProjectRoot('/does/not/matter', { PRDM_ROOT: root })).toBe(root);
  });

  test('PRDM_ROOT throws when neither marker file exists', () => {
    root = makeTmpDir();
    expect(() => discoverProjectRoot('/does/not/matter', { PRDM_ROOT: root })).toThrow(/does not contain/);
  });

  test('falls back to the nearest ancestor with a legacy prdm.config.json when no .prdm.yaml exists', () => {
    root = makeTmpDir();
    writeFiles(root, { 'prdm.config.json': '{}', 'a/b/.gitkeep': '' });
    expect(discoverProjectRoot(join(root, 'a', 'b'))).toBe(root);
  });

  test('falls back to startDir when neither .prdm.yaml nor prdm.config.json exist anywhere up', () => {
    root = makeTmpDir();
    writeFiles(root, { 'a/b/.gitkeep': '' });
    expect(discoverProjectRoot(join(root, 'a', 'b'))).toBe(join(root, 'a', 'b'));
  });
});

describe('findNestedProjectRoots', () => {
  test('finds every subdirectory with its own .prdm.yaml, excluding the root itself', async () => {
    root = makeTmpDir();
    writeFiles(root, {
      '.prdm.yaml': 'version: 1\n',
      'packages/a/.prdm.yaml': 'version: 1\n',
      'packages/b/.prdm.yaml': 'version: 1\n',
      'packages/c/README.md': '# c',
    });
    expect(await findNestedProjectRoots(root, [])).toEqual(['packages/a', 'packages/b']);
  });

  test('returns an empty array when there are no nested projects', async () => {
    root = makeTmpDir();
    writeFiles(root, { '.prdm.yaml': 'version: 1\n', 'docs/PRD-001.md': '# x' });
    expect(await findNestedProjectRoots(root, [])).toEqual([]);
  });

  test('honors the ignore list', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'vendor', 'lib'), { recursive: true });
    writeFiles(root, { 'vendor/lib/.prdm.yaml': 'version: 1\n' });
    expect(await findNestedProjectRoots(root, ['vendor/**'])).toEqual([]);
  });
});
