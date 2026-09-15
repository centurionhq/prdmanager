import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { createCommentAnchor, resolveCommentAnchor } from '../../src/comment-anchor.js';
import { BODY_ROOT } from '../../src/schema.js';

function newDoc(text: string): Y.Doc {
  const ydoc = new Y.Doc({ gc: false });
  ydoc.getText(BODY_ROOT).insert(0, text);
  return ydoc;
}

describe('createCommentAnchor / resolveCommentAnchor', () => {
  test('resolves the exact quoted text right after creation', () => {
    const ydoc = newDoc('hello world');
    const anchor = createCommentAnchor(ydoc, 6, 11);
    expect(resolveCommentAnchor(ydoc, anchor).quotedText).toBe('world');
  });

  test('also resolves the current absolute [from, to) range (WO-162: in-editor highlight/jump-to-anchor)', () => {
    const ydoc = newDoc('hello world');
    const anchor = createCommentAnchor(ydoc, 6, 11);
    expect(resolveCommentAnchor(ydoc, anchor).range).toEqual({ from: 6, to: 11 });

    ydoc.getText(BODY_ROOT).insert(0, 'PREFIX: ');
    expect(resolveCommentAnchor(ydoc, anchor).range).toEqual({ from: 14, to: 19 });
  });

  test('survives a concurrent edit elsewhere in the document (before the anchor)', () => {
    const ydoc = newDoc('hello world');
    const anchor = createCommentAnchor(ydoc, 6, 11);

    // An edit earlier in the text shifts every later character's plain offset, but the anchor is
    // relative to the "world" struct itself, not a numeric index.
    ydoc.getText(BODY_ROOT).insert(0, 'PREFIX: ');

    expect(ydoc.getText(BODY_ROOT).toString()).toBe('PREFIX: hello world');
    expect(resolveCommentAnchor(ydoc, anchor).quotedText).toBe('world');
  });

  test('survives a concurrent edit elsewhere in the document (after the anchor)', () => {
    const ydoc = newDoc('hello world');
    const anchor = createCommentAnchor(ydoc, 0, 5);

    ydoc.getText(BODY_ROOT).insert(ydoc.getText(BODY_ROOT).length, ' SUFFIX');

    expect(resolveCommentAnchor(ydoc, anchor).quotedText).toBe('hello');
  });

  test('an anchor whose text was fully deleted resolves to null ("sin ancla")', () => {
    const ydoc = newDoc('hello world');
    const anchor = createCommentAnchor(ydoc, 6, 11);

    ydoc.getText(BODY_ROOT).delete(6, 5); // deletes "world"

    expect(resolveCommentAnchor(ydoc, anchor).quotedText).toBeNull();
  });

  test('an anchor spanning a deletion that also removes surrounding text still resolves to null', () => {
    const ydoc = newDoc('hello world, goodbye');
    const anchor = createCommentAnchor(ydoc, 6, 11); // "world"

    ydoc.getText(BODY_ROOT).delete(0, ydoc.getText(BODY_ROOT).length);

    expect(resolveCommentAnchor(ydoc, anchor).quotedText).toBeNull();
  });

  test('an edit that inserts new text exactly between start and end grows the quoted text', () => {
    const ydoc = newDoc('hello world');
    const anchor = createCommentAnchor(ydoc, 0, 11);

    ydoc.getText(BODY_ROOT).insert(5, ' beautiful');

    expect(resolveCommentAnchor(ydoc, anchor).quotedText).toBe('hello beautiful world');
  });
});
