import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { applySplice, attachPreviewOriginToUndoManager, PREVIEW_ORIGIN } from '../../../src/editor/y-binding.js';
import type { Splice } from '../../../src/editor/edit-ops.js';

function linkDocs(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    Y.applyUpdate(b, update, 'remote');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    Y.applyUpdate(a, update, 'remote');
  });
}

describe('applySplice (WO-375)', () => {
  it('inserts text at the given offset under PREVIEW_ORIGIN', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    ytext.insert(0, 'hello world');

    let capturedOrigin: unknown;
    ydoc.on('update', (_update, origin) => {
      capturedOrigin = origin;
    });

    const splice: Splice = { from: 5, to: 5, insert: ' there' };
    applySplice(ytext, splice);

    expect(ytext.toString()).toBe('hello there world');
    expect(capturedOrigin).toBe(PREVIEW_ORIGIN);
  });

  it('deletes and inserts in one transaction using pre-mutation offsets (delete applied before insert)', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    ytext.insert(0, 'the quick brown fox');

    applySplice(ytext, { from: 4, to: 9, insert: 'slow' });

    expect(ytext.toString()).toBe('the slow brown fox');
  });

  it('replicates to a second Y.Doc connected purely by manual update forwarding', () => {
    const docA = new Y.Doc({ gc: false });
    const docB = new Y.Doc({ gc: false });
    const ytextA = docA.getText('body');
    docB.getText('body');
    linkDocs(docA, docB);

    ytextA.insert(0, 'shared content');
    applySplice(ytextA, { from: 0, to: 6, insert: 'joint' });

    expect(docA.getText('body').toString()).toBe('joint content');
    expect(docB.getText('body').toString()).toBe('joint content');
  });

  it('is a pure delete when insert is empty and a pure insert when the range is collapsed', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    ytext.insert(0, 'abcdef');

    applySplice(ytext, { from: 1, to: 3, insert: '' });
    expect(ytext.toString()).toBe('adef');

    applySplice(ytext, { from: 1, to: 1, insert: 'XYZ' });
    expect(ytext.toString()).toBe('aXYZdef');
  });
});

describe('attachPreviewOriginToUndoManager (WO-375)', () => {
  it('adds PREVIEW_ORIGIN to the UndoManager tracked origins so preview edits become undoable', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    const undoManager = new Y.UndoManager(ytext);

    expect(undoManager.trackedOrigins.has(PREVIEW_ORIGIN)).toBe(false);
    attachPreviewOriginToUndoManager(undoManager);
    expect(undoManager.trackedOrigins.has(PREVIEW_ORIGIN)).toBe(true);

    ytext.insert(0, 'seed ');
    undoManager.stopCapturing();
    applySplice(ytext, { from: 5, to: 5, insert: 'typed' });
    expect(ytext.toString()).toBe('seed typed');

    undoManager.undo();
    expect(ytext.toString()).toBe('seed ');
  });
});
