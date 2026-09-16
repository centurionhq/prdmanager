/**
 * WO-379: `resolveActiveSelection` maps a live DOM selection inside the preview container to the
 * `SourceBlock` it's in plus block-content-relative offsets — the same coordinate space `edit-ops.ts`
 * expects (`dom-selection.ts`'s `offsetInBlock`), so `Toolbar.tsx` can call `toggleMark`/`setBlockType`/etc.
 * directly on whatever it gets back.
 */
import { describe, expect, it } from 'vitest';
import { resolveActiveSelection } from '../../src/editor/use-preview-selection.js';
import { classifyDocument } from '../../src/editor/source-map.js';

function renderIntoDom(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function selectRange(startNode: Node, startOffset: number, endNode: Node, endOffset: number): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  selection?.addRange(range);
}

describe('resolveActiveSelection', () => {
  it('returns null when there is no selection inside the container', () => {
    const container = renderIntoDom('<p data-block-from="0" data-block-to="5">hello</p>');
    window.getSelection()?.removeAllRanges();
    expect(resolveActiveSelection(container, classifyDocument('hello'))).toBeNull();
  });

  it('resolves a collapsed caret to its block with from === to', () => {
    const source = 'hello world';
    const container = renderIntoDom('<p data-block-from="0" data-block-to="11">hello world</p>');
    const textNode = container.querySelector('p')!.firstChild!;
    selectRange(textNode, 3, textNode, 3);

    const result = resolveActiveSelection(container, classifyDocument(source));
    expect(result?.block.kind).toBe('paragraph');
    expect(result?.from).toBe(3);
    expect(result?.to).toBe(3);
  });

  it('resolves a non-collapsed selection within one block to ordered from/to offsets', () => {
    const source = 'hello world';
    const container = renderIntoDom('<p data-block-from="0" data-block-to="11">hello world</p>');
    const textNode = container.querySelector('p')!.firstChild!;
    selectRange(textNode, 6, textNode, 11);

    const result = resolveActiveSelection(container, classifyDocument(source));
    expect(result?.from).toBe(6);
    expect(result?.to).toBe(11);
  });

  it('keeps from <= to even when the user dragged the selection backwards (anchor after focus)', () => {
    const source = 'hello world';
    const container = renderIntoDom('<p data-block-from="0" data-block-to="11">hello world</p>');
    const textNode = container.querySelector('p')!.firstChild!;
    window.getSelection()?.setBaseAndExtent(textNode, 11, textNode, 6);

    const result = resolveActiveSelection(container, classifyDocument(source));
    expect(result?.from).toBe(6);
    expect(result?.to).toBe(11);
  });
});
