/**
 * WO-379 — `PreviewEditor` renders the `Toolbar` (hidden in `readOnly`), feeds it the live selection via
 * `use-preview-selection.ts`, applies whatever `Splice` it returns to `ytext`, and recognizes
 * `Ctrl`/`Cmd`+`B`/`I` anywhere in the editor even though the toolbar buttons themselves aren't focused
 * while typing.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
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

describe('PreviewEditor + Toolbar integration (WO-379)', () => {
  it('shows the toolbar when editable, and applies a button splice to ytext', async () => {
    const user = userEvent.setup();
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);

    expect(screen.getByRole('toolbar', { name: 'Formato' })).toBeTruthy();

    const textNode = document.querySelector('p[data-block-from]')!.firstChild!;
    act(() => selectText(textNode, 6, 11));

    await user.click(screen.getByRole('button', { name: 'Negrita' }));

    expect(ytext.toString()).toBe('hello **world**');
  });

  it('hides the toolbar when readOnly', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} readOnly />);

    expect(screen.queryByRole('toolbar', { name: 'Formato' })).toBeNull();
  });

  it('Ctrl+B on the editor container toggles bold on the current selection', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);

    const textNode = document.querySelector('p[data-block-from]')!.firstChild!;
    act(() => selectText(textNode, 0, 5));

    act(() => {
      screen.getByTestId('preview-editor').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(ytext.toString()).toBe('**hello** world');
  });
});
