import { describe, expect, test } from 'vitest';
import { parseRefs } from '../../src/sync/git.js';
import { normalizeText } from '../../src/util/hash.js';

const hostileLines = Array.from({ length: 200 }, () => `${' '.repeat(20_000)}x`).join('\n');

describe('linear-time text handling', () => {
  test('normalizeText handles long whitespace runs in linear time', () => {
    const started = performance.now();
    normalizeText(hostileLines);
    expect(performance.now() - started).toBeLessThan(500);
    expect(normalizeText('a  \nb\t\n\n')).toBe('a\nb');
  });

  test('parseRefs handles long whitespace runs in linear time and keeps semantics', () => {
    const started = performance.now();
    parseRefs(`${'\n'.repeat(40_000)}${hostileLines}`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(parseRefs('fix: x\n\n  Refs: WO-001, WO-002\nrefs:\tWO-003 PRD-001\nNot Refs: WO-009')).toEqual(['WO-001', 'WO-002', 'WO-003']);
  });
});
