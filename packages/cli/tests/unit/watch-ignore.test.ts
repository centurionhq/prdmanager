import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createIgnoreMatcher } from '../../src/watch-ignore.js';

const ROOT = '/repo';

describe('createIgnoreMatcher', () => {
  test('ignores nested node_modules paths', () => {
    const isIgnored = createIgnoreMatcher(ROOT, []);
    expect(isIgnored(join(ROOT, 'node_modules', 'pkg', 'dist', 'index.js'))).toBe(true);
  });

  test('ignores .git internals', () => {
    const isIgnored = createIgnoreMatcher(ROOT, []);
    expect(isIgnored(join(ROOT, '.git', 'HEAD'))).toBe(true);
  });

  test('ignores .prdm baseline writes', () => {
    const isIgnored = createIgnoreMatcher(ROOT, []);
    expect(isIgnored(join(ROOT, '.prdm', 'baseline.json'))).toBe(true);
  });

  test('does not ignore governed markdown files', () => {
    const isIgnored = createIgnoreMatcher(ROOT, []);
    expect(isIgnored(join(ROOT, 'docs', 'x.md'))).toBe(false);
  });

  test('matches additional config ignore globs', () => {
    const isIgnored = createIgnoreMatcher(ROOT, ['dist/**', 'coverage/**']);
    expect(isIgnored(join(ROOT, 'dist', 'index.js'))).toBe(true);
    expect(isIgnored(join(ROOT, 'coverage', 'lcov.info'))).toBe(true);
    expect(isIgnored(join(ROOT, 'src', 'index.ts'))).toBe(false);
  });

  test('ignores paths outside the root', () => {
    const isIgnored = createIgnoreMatcher(ROOT, []);
    expect(isIgnored('/elsewhere/file.ts')).toBe(true);
  });
});
