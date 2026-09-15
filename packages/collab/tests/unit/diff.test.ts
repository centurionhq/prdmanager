import { describe, expect, test } from 'vitest';
import { diffLines } from '../../src/diff.js';

describe('diffLines', () => {
  test('identical content is all equal', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'equal', line: 'b' },
      { type: 'equal', line: 'c' },
    ]);
  });

  test('a pure addition at the end', () => {
    expect(diffLines('a\nb', 'a\nb\nc')).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'equal', line: 'b' },
      { type: 'added', line: 'c' },
    ]);
  });

  test('a pure removal in the middle', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'removed', line: 'b' },
      { type: 'equal', line: 'c' },
    ]);
  });

  test('a changed line surfaces as a removed immediately followed by an added', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'removed', line: 'b' },
      { type: 'added', line: 'B' },
      { type: 'equal', line: 'c' },
    ]);
  });

  test('both empty', () => {
    expect(diffLines('', '')).toEqual([]);
  });

  test('from empty to non-empty is all additions', () => {
    expect(diffLines('', 'a\nb')).toEqual([
      { type: 'added', line: 'a' },
      { type: 'added', line: 'b' },
    ]);
  });

  test('from non-empty to empty is all removals', () => {
    expect(diffLines('a\nb', '')).toEqual([
      { type: 'removed', line: 'a' },
      { type: 'removed', line: 'b' },
    ]);
  });

  test('completely disjoint content removes everything then adds everything', () => {
    expect(diffLines('a\nb', 'x\ny')).toEqual([
      { type: 'removed', line: 'a' },
      { type: 'removed', line: 'b' },
      { type: 'added', line: 'x' },
      { type: 'added', line: 'y' },
    ]);
  });
});
