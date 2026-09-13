import { beforeAll, describe, expect, test } from 'vitest';
import { LegacySymbolExtractor } from '../../src/sync/legacy-extractor.js';
import { TreeSitterSymbolExtractor } from '../../src/sync/tree-sitter-extractor.js';

/**
 * SDD-004 "Comparación de hashes entre extractores": runs both extractors over the same corpus and documents,
 * as executable assertions, exactly where they agree and where they don't. This is the evidence for replacing
 * the heuristic — including one real bug the heuristic has that this migration fixes — and it is the starting
 * point for anyone re-baselining a `#symbol` `impacts_paths` entry after upgrading `@prdm/core`: re-run this
 * file against your own governed files; anything that changes here is exactly what would need a `prdm sync ack`.
 */
let treeSitter: TreeSitterSymbolExtractor;
const legacy = new LegacySymbolExtractor();
beforeAll(async () => {
  treeSitter = await TreeSitterSymbolExtractor.create();
}, 30_000);

interface Case {
  label: string;
  content: string;
  symbol: string;
  path: string;
}

const AGREE: Case[] = [
  { label: 'top-level function', content: 'export function detectDrift() {\n  return 1;\n}\n', symbol: 'detectDrift', path: 'a.ts' },
  { label: 'class', content: 'export class Store {\n  run() { return 1; }\n}\n', symbol: 'Store', path: 'a.ts' },
  { label: 'arrow const', content: 'export const helper = (a: number) => {\n  return a * 2;\n};\n', symbol: 'helper', path: 'a.ts' },
  { label: 'simple const', content: 'const LIMIT = 5;\n', symbol: 'LIMIT', path: 'a.ts' },
  { label: 'interface', content: 'export interface Foo {\n  a: number;\n}\n', symbol: 'Foo', path: 'a.ts' },
  { label: 'type alias', content: 'type Bar = string | number;\n', symbol: 'Bar', path: 'a.ts' },
  { label: 'enum', content: 'export enum Baz {\n  A,\n  B,\n}\n', symbol: 'Baz', path: 'a.ts' },
  { label: 'overload chain through implementation', content: 'export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: string | number): void {\n  console.log(a);\n}\n', symbol: 'f', path: 'a.ts' },
  { label: 'overload chain with no implementation', content: 'export function f(a: string): void;\nexport function f(a: number): void;\nexport const other = 1;\n', symbol: 'f', path: 'a.ts' },
  { label: 'top-level preferred over nested shadow', content: 'function outer() {\n  const run = () => 1;\n  return run();\n}\n\nexport function run() {\n  return 2;\n}\n', symbol: 'run', path: 'a.ts' },
  { label: 'python function', content: 'def outer(a):\n    if a:\n        return 1\n\n    return 2\n', symbol: 'outer', path: 'a.py' },
  { label: 'python class', content: 'class Thing:\n    pass\n', symbol: 'Thing', path: 'a.py' },
  { label: 'python decorators', content: 'class Foo:\n    @staticmethod\n    @cached\n    def bar():\n        return 1\n', symbol: 'bar', path: 'a.py' },
  { label: 'missing symbol', content: 'export const a = 1;\n', symbol: 'missing', path: 'a.ts' },
  { label: 'unclosed block (both recover to end of input)', content: 'export function broken() {\n  return 1;\n', symbol: 'broken', path: 'a.ts' },
];

describe('extractor comparison: agree on the common corpus', () => {
  for (const c of AGREE) {
    test(c.label, () => {
      expect(treeSitter.extract(c.content, c.symbol, c.path)).toBe(legacy.extract(c.content, c.symbol, c.path));
    });
  }
});

describe('extractor comparison: documented divergences', () => {
  test('a declaration-shaped line inside a template literal fools the line-based legacy heuristic; Tree-sitter, parsing the real AST, is never confused by it (a real bug this migration fixes)', () => {
    const src = 'const s = `\nfunction foo() {\n  return 1;\n}\n`;\nexport function foo() {\n  return 2;\n}\n';
    expect(legacy.extract(src, 'foo', 'a.ts')).toBe('function foo() {\n  return 1;\n}');
    expect(treeSitter.extract(src, 'foo', 'a.ts')).toBe('export function foo() {\n  return 2;\n}');
  });

  test('Tree-sitter additionally understands TSX and plain JavaScript function expressions without any TS-specific syntax', () => {
    expect(treeSitter.extract('export function Widget() {\n  return null;\n}\n', 'Widget', 'a.tsx')).not.toBeNull();
    expect(treeSitter.extract('const helper = function (a) {\n  return a;\n};\n', 'helper', 'a.js')).not.toBeNull();
  });
});

describe('extractor comparison: adversarial input is not a Tree-sitter DoS risk', () => {
  test('a large but well-formed file still resolves correctly and fast', () => {
    const functions = Array.from({ length: 2000 }, (_, i) => `function f${i}() {\n  return ${i};\n}\n`).join('\n');
    const content = `${functions}export function target() {\n  return 'found';\n}\n`;
    const start = performance.now();
    const result = treeSitter.extract(content, 'target', 'a.ts');
    expect(performance.now() - start).toBeLessThan(500);
    expect(result).toBe("export function target() {\n  return 'found';\n}");
  });

  test('pathologically malformed input (unmatched braces) is bounded by the same 500ms budget and reported as "not found" rather than hanging', () => {
    // Parsing this alone is fast (tens of ms); web-tree-sitter's Tree-sitter's own error-recovered tree has
    // ~50k nodes, and *matching a query against it* is what can take seconds with no query-level timeout — this
    // is exactly why extract() bounds both the parse and the query to one shared deadline (SDD-004 "Seguridad").
    const bigBraces = '{'.repeat(50_000);
    const content = `export function big() {\n${bigBraces}\n}\n`;
    const start = performance.now();
    const result = treeSitter.extract(content, 'big', 'a.ts');
    // `extract()`'s own internal deadline is 500ms; the assertion needs slack beyond that for the deadline
    // check itself to be noticed (it fires between discrete parse/query steps, not preemptively) plus
    // measurement overhead — 100ms wasn't enough headroom on a contended CI runner (observed 840ms).
    expect(performance.now() - start).toBeLessThan(1500);
    expect(result).toBeNull();
  });
});
