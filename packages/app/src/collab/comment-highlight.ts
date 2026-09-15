/**
 * In-editor highlight for text with an open comment thread (SDD-008 §"Editor"). Positions are resolved
 * once per threads-list refresh (`resolveOpenThreadHighlights`, using `@prdm/collab`'s
 * `resolveCommentAnchor` against the live `Y.Doc`) and dispatched via {@link setCommentHighlights}; between
 * refreshes, the decoration `StateField` keeps them in sync with every subsequent edit — local or remote,
 * both flow through `yCollab`'s own CodeMirror transactions — by mapping through `tr.changes` like any
 * other CodeMirror decoration, so there's no need to re-resolve the `Y.RelativePosition` on every
 * keystroke just to track a still-live anchor.
 */
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { resolveCommentAnchor } from '@prdm/collab';
import type { CommentThreadSummary } from '@prdm/contracts';
import type * as Y from 'yjs';

export interface CommentHighlightRange {
  threadId: string;
  from: number;
  to: number;
}

export const setCommentHighlights = StateEffect.define<CommentHighlightRange[]>();

const highlightMark = Decoration.mark({ class: 'cm-comment-highlight' });

export const commentHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setCommentHighlights)) continue;
      const ranges = effect.value
        .filter((r) => r.from < r.to)
        .sort((a, b) => a.from - b.from)
        .map((r) => highlightMark.range(r.from, r.to));
      next = Decoration.set(ranges);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const commentHighlightExtension = [commentHighlightField, EditorView.baseTheme({ '.cm-comment-highlight': { backgroundColor: 'var(--color-status-warning-glow, rgba(255,176,32,0.25))' } })];

function decodeAnchorBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Resolves every currently-*open* thread's anchor against `ydoc`'s live state — closed/resolved threads
 * are never highlighted, and a thread whose anchor no longer resolves ("sin ancla") is simply skipped,
 * never a crash. */
export function resolveOpenThreadHighlights(ydoc: Y.Doc, threads: readonly CommentThreadSummary[]): CommentHighlightRange[] {
  const ranges: CommentHighlightRange[] = [];
  for (const thread of threads) {
    if (thread.status !== 'open') continue;
    const anchor = { start: decodeAnchorBase64(thread.anchorStart), end: decodeAnchorBase64(thread.anchorEnd) };
    const { range } = resolveCommentAnchor(ydoc, anchor);
    if (range) ranges.push({ threadId: thread.id, from: range.from, to: range.to });
  }
  return ranges;
}
