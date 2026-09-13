import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { safeReadFile, safeWriteFile } from '../../src/util/safe-fs.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

let root = '';
let outside = '';
afterEach(() => {
  if (root) removeDir(root);
  if (outside) removeDir(outside);
});

function setup(): void {
  root = makeTmpDir('prdm-safefs-');
  outside = makeTmpDir('prdm-outside-');
}

describe('safeWriteFile', () => {
  test('writes and overwrites regular files inside the repository, creating directories', async () => {
    setup();
    await safeWriteFile(root, 'docs/feedback/FB-001.md', 'one');
    await safeWriteFile(root, 'docs/feedback/FB-001.md', 'two');
    expect(readFileSync(join(root, 'docs/feedback/FB-001.md'), 'utf8')).toBe('two');
  });

  test('exclusive mode refuses to overwrite', async () => {
    setup();
    await safeWriteFile(root, 'docs/a.md', 'x', { exclusive: true });
    await expect(safeWriteFile(root, 'docs/a.md', 'y', { exclusive: true })).rejects.toThrow();
  });

  test('refuses to write through a symlinked directory that points outside the repository', async () => {
    setup();
    mkdirSync(join(root, 'docs'));
    symlinkSync(outside, join(root, 'docs/feedback'));
    await expect(safeWriteFile(root, 'docs/feedback/FB-001.md', 'x')).rejects.toThrow(/symlink|outside/i);
    expect(existsSync(join(outside, 'FB-001.md'))).toBe(false);
  });

  test('refuses to write through a symlinked file, including dangling links', async () => {
    setup();
    mkdirSync(join(root, '.prdm'));
    symlinkSync(join(outside, 'planted.json'), join(root, '.prdm/baseline.json'));
    await expect(safeWriteFile(root, '.prdm/baseline.json', '{}')).rejects.toThrow(/symlink/i);
    expect(existsSync(join(outside, 'planted.json'))).toBe(false);
  });

  test('refuses dangling symlinked directories', async () => {
    setup();
    mkdirSync(join(root, 'docs'));
    symlinkSync(join(outside, 'missing-dir'), join(root, 'docs/artifacts'));
    await expect(safeWriteFile(root, 'docs/artifacts/ART-001.md', 'x')).rejects.toThrow(/symlink|outside/i);
    expect(existsSync(join(outside, 'missing-dir'))).toBe(false);
  });

  test('rejects lexical traversal', async () => {
    setup();
    await expect(safeWriteFile(root, '../escape.md', 'x')).rejects.toThrow(/outside/);
  });
});

describe('safeReadFile', () => {
  test('reads regular files and returns null when missing', async () => {
    setup();
    writeFileSync(join(root, 'a.ts'), 'hello');
    expect(await safeReadFile(root, 'a.ts')).toBe('hello');
    expect(await safeReadFile(root, 'missing.ts')).toBeNull();
  });

  test('allows symlinks that stay inside the repository', async () => {
    setup();
    writeFileSync(join(root, 'real.ts'), 'inside');
    symlinkSync(join(root, 'real.ts'), join(root, 'link.ts'));
    expect(await safeReadFile(root, 'link.ts')).toBe('inside');
  });

  test('refuses symlinks resolving outside the repository', async () => {
    setup();
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.ts'));
    symlinkSync(outside, join(root, 'srcdir'));
    await expect(safeReadFile(root, 'leak.ts')).rejects.toThrow(/outside/);
    await expect(safeReadFile(root, 'srcdir/secret.txt')).rejects.toThrow(/outside/);
  });

  test('refuses non-regular files and files above the size limit', async () => {
    setup();
    mkdirSync(join(root, 'dir'));
    writeFileSync(join(root, 'big.ts'), 'x'.repeat(100));
    await expect(safeReadFile(root, 'dir')).rejects.toThrow(/regular file/);
    await expect(safeReadFile(root, 'big.ts', { maxBytes: 10 })).rejects.toThrow(/exceeds/);
  });
});
