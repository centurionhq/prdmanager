import { describe, expect, test } from 'vitest';
import { LegacySymbolExtractor } from '../../src/sync/legacy-extractor.js';
import type { SymbolExtractor } from '../../src/sync/symbol-extractor.js';

describe('LegacySymbolExtractor', () => {
  test('implements SymbolExtractor directly, independent of the extractSymbol free-function wrapper', () => {
    const extractor: SymbolExtractor = new LegacySymbolExtractor();
    expect(extractor.extract('export const a = 1;\n', 'a', 'x.ts')).toBe('export const a = 1;');
    expect(extractor.extract('export const a = 1;\n', 'missing', 'x.ts')).toBeNull();
  });
});
