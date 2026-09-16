/**
 * WO-380 — `PreviewEditor` renders a remote collaborator's cursor at the block it currently falls in
 * (`awareness` prop, real `y-protocols/awareness` `Awareness` bound to the same `Y.Doc`), and publishes its
 * own local selection to that same `awareness` instance so a Markdown-tab (CodeMirror/`yCollab`) peer would
 * see it too.
 */
import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { describe, expect, it } from 'vitest';
import { PreviewEditor } from '../../src/editor/PreviewEditor.js';

function relativePositionAt(ytext: Y.Text, index: number): unknown {
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, index));
}

function selectText(node: Node, from: number, to: number): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('PreviewEditor remote cursors (WO-380)', () => {
  it('renders a remote collaborator cursor inside the block its head offset falls in', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    const source = ['# Title', '', 'Second paragraph text here.'].join('\n');
    ytext.insert(0, source);
    const awareness = new Awareness(ydoc);

    render(<PreviewEditor ytext={ytext} awareness={awareness} />);

    const headIndex = source.indexOf('paragraph');
    act(() => {
      awareness.states.set(999, {
        user: { name: 'Bea', color: '#173C7A' },
        cursor: { anchor: relativePositionAt(ytext, headIndex), head: relativePositionAt(ytext, headIndex) },
      });
      awareness.emit('change', [{ added: [999], updated: [], removed: [] }, 'test']);
    });

    const marker = screen.getByTestId('remote-cursor');
    expect(marker.textContent).toBe('Bea');
    expect(marker.closest('p[data-block-from]')?.textContent).toContain('Second paragraph');
  });

  it('publishes the local selection to awareness as a cursor field', () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    ytext.insert(0, 'hello world');
    const awareness = new Awareness(ydoc);

    render(<PreviewEditor ytext={ytext} awareness={awareness} />);

    expect(awareness.getLocalState()?.cursor).toBeUndefined();

    const textNode = document.querySelector('p[data-block-from]')!.firstChild!;
    act(() => selectText(textNode, 0, 5));

    const cursor = awareness.getLocalState()?.cursor as { anchor: unknown; head: unknown } | undefined;
    expect(cursor).toBeTruthy();
    const headIndex = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor!.head), ydoc)?.index;
    expect(headIndex).toBe(5);
  });
});
