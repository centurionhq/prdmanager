import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { SymbolCache } from '../../src/sync/symbol-cache.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

describe('SymbolCache', () => {
  test('a cache miss is undefined; loading a directory with no cache file yet is empty, not an error', async () => {
    root = makeTmpDir();
    const cache = await SymbolCache.load(root);
    expect(cache.get('src/a.ts#helper', 'file-hash')).toBeUndefined();
  });

  test('set/get round-trips within the same instance, keyed by (key, current file hash)', async () => {
    root = makeTmpDir();
    const cache = await SymbolCache.load(root);
    cache.set('src/a.ts#helper', 'file-hash-1', 'block-hash-1');
    expect(cache.get('src/a.ts#helper', 'file-hash-1')).toBe('block-hash-1');
    // A different current file hash is a miss: the file changed since this was cached.
    expect(cache.get('src/a.ts#helper', 'file-hash-2')).toBeUndefined();
  });

  test('saveIfDirty writes nothing when nothing was set (read-only refresh never touches disk)', async () => {
    root = makeTmpDir();
    const cache = await SymbolCache.load(root);
    await cache.saveIfDirty(root);
    expect(existsSync(join(root, '.prdm', 'symbol-cache.json'))).toBe(false);
  });

  test('saveIfDirty persists entries, and a fresh load() recovers them', async () => {
    root = makeTmpDir();
    const first = await SymbolCache.load(root);
    first.set('src/a.ts#helper', 'file-hash-1', 'block-hash-1');
    first.set('src/b.py#outer', 'file-hash-2', 'block-hash-2');
    await first.saveIfDirty(root);
    expect(existsSync(join(root, '.prdm', 'symbol-cache.json'))).toBe(true);

    const second = await SymbolCache.load(root);
    expect(second.get('src/a.ts#helper', 'file-hash-1')).toBe('block-hash-1');
    expect(second.get('src/b.py#outer', 'file-hash-2')).toBe('block-hash-2');
  });

  test('a corrupt cache file is treated as empty rather than failing', async () => {
    root = makeTmpDir();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(join(root, '.prdm', 'symbol-cache.json'), '{ not json', 'utf8');
    const cache = await SymbolCache.load(root);
    expect(cache.get('anything', 'x')).toBeUndefined();
  });

  test('the persisted file has deterministic key order (stable diffs)', async () => {
    root = makeTmpDir();
    const cache = await SymbolCache.load(root);
    cache.set('z', 'h', 'z-hash');
    cache.set('a', 'h', 'a-hash');
    await cache.saveIfDirty(root);
    const raw = readFileSync(join(root, '.prdm', 'symbol-cache.json'), 'utf8');
    expect(Object.keys(JSON.parse(raw))).toEqual(['a', 'z']);
  });
});
