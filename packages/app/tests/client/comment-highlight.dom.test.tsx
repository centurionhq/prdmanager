import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, test } from 'vitest';
import { createCommentAnchor } from '@prdm/collab';
import { commentHighlightExtension, resolveOpenThreadHighlights, setCommentHighlights } from '../../src/collab/comment-highlight.js';
import type { CommentThreadSummary } from '@prdm/contracts';

function makeView(doc: string): EditorView {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new EditorView({ state: EditorState.create({ doc, extensions: [commentHighlightExtension] }), parent: container });
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fakeThread(overrides: Partial<CommentThreadSummary> & { anchorStart: string; anchorEnd: string }): CommentThreadSummary {
  return {
    id: 't1',
    documentId: 'd1',
    quotedText: 'world',
    status: 'open',
    createdBy: 'u1',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    comments: [],
    ...overrides,
  };
}

describe('resolveOpenThreadHighlights', () => {
  test('resolves an open thread anchor to the current [from, to) range', () => {
    const ydoc = new Y.Doc({ gc: false });
    ydoc.getText('body').insert(0, 'hello world');
    const anchor = createCommentAnchor(ydoc, 6, 11);
    const thread = fakeThread({ anchorStart: toBase64(anchor.start), anchorEnd: toBase64(anchor.end) });

    expect(resolveOpenThreadHighlights(ydoc, [thread])).toEqual([{ threadId: 't1', from: 6, to: 11 }]);
  });

  test('skips a resolved thread', () => {
    const ydoc = new Y.Doc({ gc: false });
    ydoc.getText('body').insert(0, 'hello world');
    const anchor = createCommentAnchor(ydoc, 6, 11);
    const thread = fakeThread({ anchorStart: toBase64(anchor.start), anchorEnd: toBase64(anchor.end), status: 'resolved' });

    expect(resolveOpenThreadHighlights(ydoc, [thread])).toEqual([]);
  });

  test('skips a thread whose anchor no longer resolves ("sin ancla")', () => {
    const ydoc = new Y.Doc({ gc: false });
    ydoc.getText('body').insert(0, 'hello world');
    const anchor = createCommentAnchor(ydoc, 6, 11);
    ydoc.getText('body').delete(6, 5);
    const thread = fakeThread({ anchorStart: toBase64(anchor.start), anchorEnd: toBase64(anchor.end) });

    expect(resolveOpenThreadHighlights(ydoc, [thread])).toEqual([]);
  });
});

describe('commentHighlightField (DOM)', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  test('renders a highlighted span for a dispatched range', () => {
    view = makeView('hello world');
    view.dispatch({ effects: setCommentHighlights.of([{ threadId: 't1', from: 6, to: 11 }]) });
    expect(view.dom.querySelectorAll('.cm-comment-highlight')).toHaveLength(1);
  });

  test('the highlight range shifts when text is inserted before it (position mapping via tr.changes)', () => {
    view = makeView('hello world');
    view.dispatch({ effects: setCommentHighlights.of([{ threadId: 't1', from: 6, to: 11 }]) });

    view.dispatch({ changes: { from: 0, insert: 'XX' } });

    // "XXhello world" — "world" now starts at index 8, not 6; the mark tracks the edit automatically
    // (StateField.map(tr.changes)), with no need to re-resolve the Y.RelativePosition for a local edit.
    const mark = view.dom.querySelector('.cm-comment-highlight');
    expect(mark?.textContent).toBe('world');
  });
});
