import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { safeCreateAtomic, safeReplaceAtomic, safeUnlink } from '../../src/util/safe-fs.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

let root = '';
let outside = '';
afterEach(() => {
  if (root) removeDir(root);
  if (outside) removeDir(outside);
});

function setup(): void {
  root = makeTmpDir('prdm-safefs-atomic-');
  outside = makeTmpDir('prdm-outside-');
}

describe('safeCreateAtomic', () => {
  test('creates a new file and leaves no temp files behind', async () => {
    setup();
    await safeCreateAtomic(root, 'docs/fb/FB-001.md', 'hello');
    expect(readFileSync(join(root, 'docs/fb/FB-001.md'), 'utf8')).toBe('hello');
    expect(existsSync(join(root, 'docs/fb'))).toBe(true);
  });

  test('refuses to overwrite an existing file', async () => {
    setup();
    await safeCreateAtomic(root, 'docs/a.md', 'x');
    await expect(safeCreateAtomic(root, 'docs/a.md', 'y')).rejects.toThrow(/already exists/);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('x');
  });

  test('refuses to create through a symlinked directory that escapes the repository', async () => {
    setup();
    mkdirSync(join(root, 'docs'));
    symlinkSync(outside, join(root, 'docs/escape'));
    await expect(safeCreateAtomic(root, 'docs/escape/FB-001.md', 'x')).rejects.toThrow(/symlink|outside/i);
    expect(existsSync(join(outside, 'FB-001.md'))).toBe(false);
  });

  test('rejects lexical traversal', async () => {
    setup();
    await expect(safeCreateAtomic(root, '../escape.md', 'x')).rejects.toThrow(/outside/);
  });
});

describe('safeReplaceAtomic', () => {
  test('replaces existing content atomically', async () => {
    setup();
    writeFileSync(join(root, 'a.md'), 'one', { flag: 'w' });
    await safeReplaceAtomic(root, 'a.md', 'two');
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('two');
  });

  test('creates the file when it does not yet exist', async () => {
    setup();
    await safeReplaceAtomic(root, 'docs/new.md', 'content');
    expect(readFileSync(join(root, 'docs/new.md'), 'utf8')).toBe('content');
  });

  test('replacing a symlinked path swaps the link itself (rename never follows it), leaving its target untouched', async () => {
    setup();
    writeFileSync(join(outside, 'planted.md'), 'secret');
    symlinkSync(join(outside, 'planted.md'), join(root, 'link.md'));
    await safeReplaceAtomic(root, 'link.md', 'x');
    expect(readFileSync(join(outside, 'planted.md'), 'utf8')).toBe('secret');
    expect(readFileSync(join(root, 'link.md'), 'utf8')).toBe('x');
  });

  test('refuses to replace through a symlinked directory that escapes the repository', async () => {
    setup();
    mkdirSync(join(root, 'docs'));
    symlinkSync(outside, join(root, 'docs/escape'));
    await expect(safeReplaceAtomic(root, 'docs/escape/a.md', 'x')).rejects.toThrow(/symlink|outside/i);
    expect(existsSync(join(outside, 'a.md'))).toBe(false);
  });
});

describe('safeUnlink', () => {
  test('removes an existing file', async () => {
    setup();
    writeFileSync(join(root, 'a.md'), 'x');
    await safeUnlink(root, 'a.md');
    expect(existsSync(join(root, 'a.md'))).toBe(false);
  });

  test('is a no-op when the file is already gone', async () => {
    setup();
    await expect(safeUnlink(root, 'missing.md')).resolves.toBeUndefined();
  });

  test('refuses to remove a file that resolves outside the repository', async () => {
    setup();
    writeFileSync(join(outside, 'planted.md'), 'secret');
    symlinkSync(join(outside, 'planted.md'), join(root, 'link.md'));
    await expect(safeUnlink(root, 'link.md')).rejects.toThrow(/outside/i);
    expect(existsSync(join(outside, 'planted.md'))).toBe(true);
  });
});
