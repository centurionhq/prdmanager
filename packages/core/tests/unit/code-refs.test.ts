import { afterEach, describe, expect, test } from 'vitest';
import { extractSymbol, resolveGoverned } from '../../src/sync/code-refs.js';
import { SymbolCache } from '../../src/sync/symbol-cache.js';
import type { SymbolExtractor } from '../../src/sync/symbol-extractor.js';
import { sha256 } from '../../src/util/hash.js';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

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

  test('hashes overloaded function signatures through the implementation body', () => {
    const overloads = `export function f(a: string): void;
export function f(a: number): void;
export function f(a: string | number): void {
  console.log(a);
}
`;
    expect(extractSymbol(overloads, 'f', 'a.ts')).toBe(
      'export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: string | number): void {\n  console.log(a);\n}',
    );
  });

  test('falls back to the last signature when overloads have no implementation', () => {
    const ambient = `export function f(a: string): void;
export function f(a: number): void;
export const other = 1;
`;
    expect(extractSymbol(ambient, 'f', 'a.ts')).toBe(
      'export function f(a: string): void;\nexport function f(a: number): void;',
    );
  });

  test('ignores braces and parens inside strings, template literals and comments', () => {
    const tricky = `export function g(): string {
  const s = "not a } real close";
  const t = \`also { not real\`;
  // this is a { fake comment
  /* block comment with } inside */
  return s + t;
}
`;
    expect(extractSymbol(tricky, 'g', 'a.ts')).toBe(
      [
        'export function g(): string {',
        '  const s = "not a } real close";',
        '  const t = `also { not real`;',
        '  // this is a { fake comment',
        '  /* block comment with } inside */',
        '  return s + t;',
        '}',
      ].join('\n'),
    );
  });

  test('hashes multi-line type unions and chained builder calls to their true end', () => {
    const multiline = `export type Status =
  | 'draft'
  | 'active'
  | 'archived';

export const schema = z.object({
  a: z.string(),
}).extend({
  b: z.number(),
});
`;
    expect(extractSymbol(multiline, 'Status', 'a.ts')).toBe(
      "export type Status =\n  | 'draft'\n  | 'active'\n  | 'archived';",
    );
    expect(extractSymbol(multiline, 'schema', 'a.ts')).toBe(
      'export const schema = z.object({\n  a: z.string(),\n}).extend({\n  b: z.number(),\n});',
    );
  });

  test('prefers the top-level declaration over a nested one with the same name', () => {
    const shadowed = `function outer() {
  const run = () => 1;
  return run();
}

export function run() {
  return 2;
}
`;
    expect(extractSymbol(shadowed, 'run', 'a.ts')).toBe('export function run() {\n  return 2;\n}');
  });

  test('falls back to end of file when a block never closes', () => {
    const broken = `export function broken() {
  return 1;
`;
    expect(extractSymbol(broken, 'broken', 'a.ts')).toBe('export function broken() {\n  return 1;');
  });

  test('includes decorators directly above a python def in the extracted block', () => {
    const decorated = `import os

class Foo:
    @staticmethod
    @cached
    def bar():
        return 1
`;
    // normalizeText's overall .trim() strips only the first line's leading indent; later lines keep theirs.
    expect(extractSymbol(decorated, 'bar', 'a.py')).toBe(
      '@staticmethod\n    @cached\n    def bar():\n        return 1',
    );
  });

  test('extracts pathological inputs in well under 500ms (linear scan, no backtracking)', () => {
    const bigBraces = '{'.repeat(1_000_000);
    const bracesContent = `export function big() {\n${bigBraces}\n}\n`;
    const startBraces = performance.now();
    const bracesResult = extractSymbol(bracesContent, 'big', 'a.ts');
    expect(performance.now() - startBraces).toBeLessThan(500);
    expect(bracesResult).not.toBeNull();

    const wideLine = ' '.repeat(200_000);
    const wideContent = `export function wide() {\n${wideLine}\n  return 1;\n}\n`;
    const startWide = performance.now();
    const wideResult = extractSymbol(wideContent, 'wide', 'a.ts');
    expect(performance.now() - startWide).toBeLessThan(500);
    expect(wideResult).toContain('export function wide() {');
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
    expect(warnings).toEqual(['impacts_paths pattern "src/nothing/**" matches no files']);
  });

  test('excludes files that belong to a nested project', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'src/a.ts': 'a', 'src/sub/.prdm.yaml': 'version: 1', 'src/sub/b.ts': 'b' });
    const { refs, warnings } = await resolveGoverned(root, ['src/**', 'src/sub/b.ts'], []);
    expect(refs.map((r) => r.key)).toEqual(['src/a.ts']);
    expect(warnings).toEqual(['impacts_paths pattern "src/sub/b.ts" belongs to nested project "src/sub"']);
  });

  test('rejects patterns escaping the repository', async () => {
    root = makeTmpDir();
    const { refs, warnings } = await resolveGoverned(root, ['../outside/**', '/etc/passwd'], []);
    expect(refs).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/outside/);
  });

  test('SDD-004: dispatches to Tree-sitter for a supported extension, and to the legacy heuristic for one it has no grammar for', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'src/a.ts': ts, 'src/a.txt': ts.replace('a.ts', 'a.txt') });
    const { refs: fromTreeSitter } = await resolveGoverned(root, ['src/a.ts#helper'], []);
    const { refs: fromLegacy } = await resolveGoverned(root, ['src/a.txt#helper'], []);
    // Same source text, only the extension differs: both land on the exact same hash, proving the unsupported
    // extension really was routed to the legacy heuristic (which is extension-agnostic for TS-shaped syntax)
    // rather than silently reporting the symbol as missing.
    expect(fromTreeSitter[0]?.hash).not.toBeNull();
    expect(fromLegacy[0]?.hash).toBe(fromTreeSitter[0]?.hash);
  });

  test('SDD-004: a symbol cache skips the extractor entirely when the file has not changed since it was cached', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'src/a.ts': ts });
    let calls = 0;
    const countingExtractor: SymbolExtractor = { extract: (content, symbol, path) => (calls++, extractSymbol(content, symbol, path)) };
    const cache = await SymbolCache.load(root);

    const first = await resolveGoverned(root, ['src/a.ts#helper'], [], { extractor: countingExtractor, cache });
    expect(calls).toBe(1);
    const second = await resolveGoverned(root, ['src/a.ts#helper'], [], { extractor: countingExtractor, cache });
    expect(calls).toBe(1); // same cache instance, file unchanged: no second call
    expect(second.refs).toEqual(first.refs);

    writeFiles(root, { 'src/a.ts': ts.replace('return a * 2;', 'return a * 3;') });
    await resolveGoverned(root, ['src/a.ts#helper'], [], { extractor: countingExtractor, cache });
    expect(calls).toBe(2); // file changed: cache correctly misses and re-extracts
  });
});
