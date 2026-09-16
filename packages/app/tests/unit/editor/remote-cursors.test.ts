/**
 * WO-380 — `resolveRemoteCursorPositions` is pure: given the live `Y.Doc`, a (possibly simulated)
 * awareness states map, and the current `SourceBlock`s, it maps every *other* client's `cursor.head`
 * relative position to the block it currently falls inside. No DOM, no real `Awareness`/Hocuspocus
 * instance required — a plain `Map` is exactly what `Awareness#getStates()` returns anyway.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { resolveRemoteCursorPositions } from '../../../src/editor/remote-cursors.js';
import { classifyDocument } from '../../../src/editor/source-map.js';

function relativePositionAt(ytext: Y.Text, index: number): unknown {
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, index));
}

describe('resolveRemoteCursorPositions', () => {
  it('maps a remote collaborator cursor to the block its head offset currently falls inside', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    const source = ['# Title', '', 'Second paragraph text here.'].join('\n');
    ytext.insert(0, source);
    const blocks = classifyDocument(source);
    const secondParagraph = blocks[1]!;
    const headIndex = source.indexOf('paragraph');

    const states = new Map([
      [
        999,
        {
          user: { name: 'Bea', color: '#173C7A' },
          cursor: { anchor: relativePositionAt(ytext, headIndex), head: relativePositionAt(ytext, headIndex) },
        },
      ],
    ]);

    const markers = resolveRemoteCursorPositions(ydoc, states, ydoc.clientID, blocks);

    expect(markers).toEqual([{ clientId: 999, name: 'Bea', color: '#173C7A', blockFrom: secondParagraph.from }]);
  });

  it('skips the local client id, states without a cursor field, and unresolvable relative positions', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    ytext.insert(0, 'hello world');
    const blocks = classifyDocument('hello world');

    const foreignDoc = new Y.Doc({ gc: false });
    const foreignText = foreignDoc.getText('body');
    foreignText.insert(0, 'unrelated');

    const states = new Map<number, Record<string, unknown>>([
      [ydoc.clientID, { user: { name: 'Me' }, cursor: { anchor: relativePositionAt(ytext, 0), head: relativePositionAt(ytext, 0) } }],
      [1, { user: { name: 'NoCursor' } }],
      [2, { user: { name: 'Unresolvable' }, cursor: { anchor: relativePositionAt(foreignText, 0), head: relativePositionAt(foreignText, 0) } }],
    ]);

    expect(resolveRemoteCursorPositions(ydoc, states, ydoc.clientID, blocks)).toEqual([]);
  });

  it('falls back to a default name and color when the user state is missing them', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    ytext.insert(0, 'hello world');
    const blocks = classifyDocument('hello world');

    const states = new Map([[7, { cursor: { anchor: relativePositionAt(ytext, 1), head: relativePositionAt(ytext, 1) } }]]);

    const [marker] = resolveRemoteCursorPositions(ydoc, states, ydoc.clientID, blocks);
    expect(marker?.name).toBe('Colaborador');
    expect(marker?.color).toBeTruthy();
  });
});
