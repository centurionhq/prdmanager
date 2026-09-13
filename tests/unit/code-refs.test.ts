import { afterEach, describe, expect, test } from 'vitest';
import { extractSymbol, resolveGoverned } from '../../src/sync/code-refs.js';
import { sha256 } from '../../src/util/hash.js';
import { makeTmpDir, removeDir, writeFiles } from '../helpers/tmp.js';

const ts = `import x from 'y';

export async function detectDrift(input: Input): Result {
  if (input) {
    return { a: 1 };
  }
  return {};
}

export class Store {
  run() { return 1; }
}

export const helper = (a: number) => {
  return a * 2;
};

const LIMIT = 5;
`;

const py = `import os

def outer(a):
    if a:
        return 1

    return 2

class Thing:
    pass
`;

describe('extractSymbol', () => {
  test('extracts brace-delimited TS function, class and arrow const', () => {
    expect(extractSymbol(ts, 'detectDrift', 'a.ts')).toBe(
      'export async function detectDrift(input: Input): Result {\n  if (input) {\n    return { a: 1 };\n  }\n  return {};\n}',
    );
    expect(extractSymbol(ts, 'Store', 'a.ts')).toBe('export class Store {\n  run() { return 1; }\n}');
    expect(extractSymbol(ts, 'helper', 'a.ts')).toBe('export const helper = (a: number) => {\n  return a * 2;\n};');
    expect(extractSymbol(ts, 'LIMIT', 'a.ts')).toBe('const LIMIT = 5;');
  });

  test('extracts indentation-delimited python blocks', () => {
    expect(extractSymbol(py, 'outer', 'a.py')).toBe('def outer(a):\n    if a:\n        return 1\n\n    return 2');
    expect(extractSymbol(py, 'Thing', 'a.py')).toBe('class Thing:\n    pass');
  });

  test('returns null when the symbol does not exist or is only a prefix match', () => {
    expect(extractSymbol(ts, 'detect', 'a.ts')).toBeNull();
    expect(extractSymbol(py, 'missing', 'a.py')).toBeNull();
  });
});

describe('resolveGoverned', () => {
  let root = '';
  afterEach(() => root && removeDir(root));

  test('expands globs, hashes files and symbols, flags missing refs and empty globs', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'src/sync/a.ts': ts, 'src/sync/b.py': py, 'src/other.ts': 'x' });
    const { refs, warnings } = await resolveGoverned(
      root,
      ['src/sync/**', 'src/sync/a.ts#helper', 'src/gone.ts', 'src/nothing/**', 'src/sync/a.ts#nope'],
      [],
    );
    expect(refs).toEqual([
      { key: 'src/sync/a.ts', path: 'src/sync/a.ts', symbol: null, hash: sha256(ts.replace(/\s+$/, '')) },
      { key: 'src/sync/b.py', path: 'src/sync/b.py', symbol: null, hash: sha256(py.replace(/\s+$/, '')) },
      { key: 'src/sync/a.ts#helper', path: 'src/sync/a.ts', symbol: 'helper', hash: sha256('export const helper = (a: number) => {\n  return a * 2;\n};') },
      { key: 'src/gone.ts', path: 'src/gone.ts', symbol: null, hash: null },
      { key: 'src/sync/a.ts#nope', path: 'src/sync/a.ts', symbol: 'nope', hash: null },
    ]);
    expect(warnings).toEqual(['governs pattern "src/nothing/**" matches no files']);
  });

  test('rejects patterns escaping the repository', async () => {
    root = makeTmpDir();
    const { refs, warnings } = await resolveGoverned(root, ['../outside/**', '/etc/passwd'], []);
    expect(refs).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/outside/);
  });
});
