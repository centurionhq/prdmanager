/**
 * WO-381 — "Comentar selección" in `PreviewEditor`: appears only with a non-collapsed selection and an
 * `onCreateComment` callback, and calls it with the selection's absolute source offsets (the same
 * `startIndex`/`endIndex` shape `CreateCommentThreadInput` expects) plus the typed body.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { PreviewEditor } from '../../src/editor/PreviewEditor.js';

function docWithBody(body: string): Y.Text {
  const ydoc = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('body');
  ytext.insert(0, body);
  return ytext;
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

describe('PreviewEditor "Comentar selección" (WO-381)', () => {
  it('is absent without a selection or without onCreateComment', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    expect(screen.queryByRole('button', { name: 'Comentar selección' })).toBeNull();
  });

  it('appears with a non-collapsed selection and creates a thread with the right offsets and body', async () => {
    const user = userEvent.setup();
    const ytext = docWithBody('hello world');
    const onCreateComment = vi.fn();
    render(<PreviewEditor ytext={ytext} onCreateComment={onCreateComment} />);

    const textNode = document.querySelector('p[data-block-from]')!.firstChild!;
    act(() => selectText(textNode, 6, 11));

    await user.click(await screen.findByRole('button', { name: 'Comentar selección' }));
    await user.type(screen.getByLabelText('Nuevo comentario'), 'ojo con esto');
    await user.click(screen.getByRole('button', { name: 'Comentar' }));

    expect(onCreateComment).toHaveBeenCalledWith({ startIndex: 6, endIndex: 11, body: 'ojo con esto' });
  });
});
