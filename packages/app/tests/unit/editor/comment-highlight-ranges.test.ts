/**
 * WO-381 — `splitByHighlights` slices a run's raw source text into contiguous segments tagged with the
 * open-thread id covering each (or `null`), so `PreviewEditor.tsx` can wrap only the highlighted part of a
 * plain-text run in a `<mark>` instead of the whole run.
 */
import { describe, expect, it } from 'vitest';
import { splitByHighlights, runIntersectsHighlight } from '../../../src/editor/comment-highlight-ranges.js';

describe('splitByHighlights', () => {
  it('returns the whole text as one unhighlighted segment when no range overlaps', () => {
    expect(splitByHighlights('hello world', 0, [])).toEqual([{ text: 'hello world', threadId: null }]);
  });

  it('splits into before/highlighted/after when a range covers the middle', () => {
    const result = splitByHighlights('hello world', 0, [{ threadId: 't1', from: 6, to: 11 }]);
    expect(result).toEqual([
      { text: 'hello ', threadId: null },
      { text: 'world', threadId: 't1' },
    ]);
  });

  it('clips a highlight range to the run bounds when it extends past either edge', () => {
    const result = splitByHighlights('world', 6, [{ threadId: 't1', from: 0, to: 20 }]);
    expect(result).toEqual([{ text: 'world', threadId: 't1' }]);
  });

  it('handles multiple non-overlapping ranges within the same run', () => {
    const result = splitByHighlights('abcdefgh', 0, [
      { threadId: 't2', from: 5, to: 8 },
      { threadId: 't1', from: 0, to: 2 },
    ]);
    expect(result).toEqual([
      { text: 'ab', threadId: 't1' },
      { text: 'cde', threadId: null },
      { text: 'fgh', threadId: 't2' },
    ]);
  });
});

describe('runIntersectsHighlight', () => {
  it('returns the thread id of the first range overlapping the given span', () => {
    expect(runIntersectsHighlight(2, 5, [{ threadId: 't1', from: 4, to: 10 }])).toBe('t1');
  });

  it('returns null when nothing overlaps', () => {
    expect(runIntersectsHighlight(2, 5, [{ threadId: 't1', from: 10, to: 20 }])).toBeNull();
  });
});
