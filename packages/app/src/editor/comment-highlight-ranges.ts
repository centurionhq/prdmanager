/**
 * Splits a run's raw source text into segments tagged by which open comment thread (if any) covers each
 * one (SDD-014 §"Editor de vista previa", WO-381). `PreviewEditor.tsx` uses this only for `text`/`softbreak`
 * runs, whose raw source span is exactly what's displayed — no markdown syntax to account for — so a
 * highlight range (absolute source offsets, from `../collab/comment-highlight.js`'s
 * `resolveOpenThreadHighlights`) applies directly. Formatted runs (bold/italic/link/etc.) are simpler: they
 * highlight as a whole via {@link runIntersectsHighlight} rather than slicing through their delimiters.
 */
import type { CommentHighlightRange } from '../collab/comment-highlight.js';

export interface TextHighlightSegment {
  text: string;
  threadId: string | null;
}

export function splitByHighlights(text: string, from: number, ranges: readonly CommentHighlightRange[]): TextHighlightSegment[] {
  const to = from + text.length;
  const overlapping = ranges
    .filter((range) => range.from < to && range.to > from)
    .map((range) => ({ threadId: range.threadId, from: Math.max(range.from, from), to: Math.min(range.to, to) }))
    .sort((a, b) => a.from - b.from);

  if (overlapping.length === 0) return [{ text, threadId: null }];

  const segments: TextHighlightSegment[] = [];
  let cursor = from;
  for (const range of overlapping) {
    if (range.from > cursor) segments.push({ text: text.slice(cursor - from, range.from - from), threadId: null });
    segments.push({ text: text.slice(range.from - from, range.to - from), threadId: range.threadId });
    cursor = range.to;
  }
  if (cursor < to) segments.push({ text: text.slice(cursor - from), threadId: null });
  return segments;
}

export function runIntersectsHighlight(from: number, to: number, ranges: readonly CommentHighlightRange[]): string | null {
  return ranges.find((range) => range.from < to && range.to > from)?.threadId ?? null;
}
