import { beforeAll, describe, expect, test } from 'vitest';
import { TreeSitterSymbolExtractor } from '../../src/sync/tree-sitter-extractor.js';

/**
 * SDD-004 / ADR-003: locks in the exact web-tree-sitter@0.25.10 + tree-sitter-wasms@0.1.13 pairing this ADR
 * pinned — if either package is ever bumped without re-verifying ABI compatibility, `create()` here fails
 * loudly (`Language.load` throws) instead of silently shipping a broken extractor.
 */
let extractor: TreeSitterSymbolExtractor;
beforeAll(async () => {
  extractor = await TreeSitterSymbolExtractor.create();
}, 30_000);

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

describe('TreeSitterSymbolExtractor: parity with the legacy heuristic', () => {
  test('extracts brace-delimited TS function, class and arrow const', () => {
    expect(extractor.extract(ts, 'detectDrift', 'a.ts')).toBe(
      'export async function detectDrift(input: Input): Result {\n  if (input) {\n    return { a: 1 };\n  }\n  return {};\n}',
    );
    expect(extractor.extract(ts, 'Store', 'a.ts')).toBe('export class Store {\n  run() { return 1; }\n}');
    expect(extractor.extract(ts, 'helper', 'a.ts')).toBe('export const helper = (a: number) => {\n  return a * 2;\n};');
    expect(extractor.extract(ts, 'LIMIT', 'a.ts')).toBe('const LIMIT = 5;');
  });

  test('extracts indentation-delimited python blocks', () => {
    expect(extractor.extract(py, 'outer', 'a.py')).toBe('def outer(a):\n    if a:\n        return 1\n\n    return 2');
    expect(extractor.extract(py, 'Thing', 'a.py')).toBe('class Thing:\n    pass');
  });

  test('returns null when the symbol does not exist or is only a prefix match', () => {
    expect(extractor.extract(ts, 'detect', 'a.ts')).toBeNull();
    expect(extractor.extract(py, 'missing', 'a.py')).toBeNull();
  });

  test('extracts overloaded function signatures through the implementation body', () => {
    const overloads = `export function f(a: string): void;
export function f(a: number): void;
export function f(a: string | number): void {
  console.log(a);
}
`;
    expect(extractor.extract(overloads, 'f', 'a.ts')).toBe(
      'export function f(a: string): void;\nexport function f(a: number): void;\nexport function f(a: string | number): void {\n  console.log(a);\n}',
    );
  });

  test('falls back to the last signature when overloads have no implementation', () => {
    const ambient = `export function f(a: string): void;
export function f(a: number): void;
export const other = 1;
`;
    expect(extractor.extract(ambient, 'f', 'a.ts')).toBe('export function f(a: string): void;\nexport function f(a: number): void;');
  });

  test('ignores braces and parens inside strings, template literals and comments (parsed as an AST, never scanned)', () => {
    const tricky = `export function g(): string {
  const s = "not a } real close";
  const t = \`also { not real\`;
  // this is a { fake comment
  /* block comment with } inside */
  return s + t;
}
`;
    expect(extractor.extract(tricky, 'g', 'a.ts')).toBe(
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

  test('extracts multi-line type unions and chained builder calls to their true end', () => {
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
    expect(extractor.extract(multiline, 'Status', 'a.ts')).toBe("export type Status =\n  | 'draft'\n  | 'active'\n  | 'archived';");
    expect(extractor.extract(multiline, 'schema', 'a.ts')).toBe(
      'export const schema = z.object({\n  a: z.string(),\n}).extend({\n  b: z.number(),\n});',
    );
  });

  test('prefers the top-level declaration (by real AST depth) over a nested one with the same name', () => {
    const shadowed = `function outer() {
  const run = () => 1;
  return run();
}

export function run() {
  return 2;
}
`;
    expect(extractor.extract(shadowed, 'run', 'a.ts')).toBe('export function run() {\n  return 2;\n}');
  });

  test('includes decorators directly above a python def in the extracted block', () => {
    const decorated = `import os

class Foo:
    @staticmethod
    @cached
    def bar():
        return 1
`;
    expect(extractor.extract(decorated, 'bar', 'a.py')).toBe('@staticmethod\n    @cached\n    def bar():\n        return 1');
  });
});

describe('TreeSitterSymbolExtractor: interface/type/enum, plain JavaScript and TSX', () => {
  test('extracts interface, type alias and enum declarations', () => {
    const src = `export interface Foo {\n  a: number;\n}\n\ntype Bar = string | number;\n\nexport enum Baz {\n  A,\n  B,\n}\n`;
    expect(extractor.extract(src, 'Foo', 'a.ts')).toBe('export interface Foo {\n  a: number;\n}');
    expect(extractor.extract(src, 'Bar', 'a.ts')).toBe('type Bar = string | number;');
    expect(extractor.extract(src, 'Baz', 'a.ts')).toBe('export enum Baz {\n  A,\n  B,\n}');
  });

  test('extracts a plain JavaScript function and class the same way, with no TS-only node types', () => {
    const src = `class Widget {}\n\nfunction render() {\n  return 1;\n}\n\nconst helper = (a) => a + 1;\n`;
    expect(extractor.extract(src, 'Widget', 'a.js')).toBe('class Widget {}');
    expect(extractor.extract(src, 'render', 'a.js')).toBe('function render() {\n  return 1;\n}');
    expect(extractor.extract(src, 'helper', 'a.js')).toBe('const helper = (a) => a + 1;');
  });

  test('extracts from a .tsx file using the tsx grammar', () => {
    const src = `export function Widget() {\n  return null;\n}\n`;
    expect(extractor.extract(src, 'Widget', 'a.tsx')).toBe('export function Widget() {\n  return null;\n}');
  });

  test('returns null for an unsupported file extension', () => {
    expect(extractor.extract('fn f() {}', 'f', 'a.rs')).toBeNull();
  });

  test('a function expression assigned to a const is extracted like an arrow function', () => {
    const src = `export const helper = function (a) {\n  return a;\n};\n`;
    expect(extractor.extract(src, 'helper', 'a.js')).toBe('export const helper = function (a) {\n  return a;\n};');
  });
});
