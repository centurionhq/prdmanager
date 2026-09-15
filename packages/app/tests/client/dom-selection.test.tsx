/**
 * WO-377 — pure DOM <-> source offset mapping, tested against a hand-built DOM tree matching exactly what
 * PreviewEditor.tsx renders for a given SourceBlock list (a `data-block-from` attribute per editable block,
 * one Text node per EditableRun in block.runs order), so this stays a focused unit test independent of React
 * rendering.
 */
import { describe, expect, it } from 'vitest';
import { blockOffsetToDomPosition, domPositionToBlockOffset } from '../../src/editor/dom-selection.js';
import { classifyDocument } from '../../src/editor/source-map.js';

function buildParagraphDom(source: string, tagFrom: number): { root: HTMLElement; textNode: Text } {
  const blocks = classifyDocument(source);
  const block = blocks[0]!;
  const p = document.createElement('p');
  p.setAttribute('data-block-from', String(block.from));
  const textNode = document.createTextNode(source.slice(block.contentFrom, block.to));
  p.appendChild(textNode);
  return { root: p, textNode };
}

describe('domPositionToBlockOffset (WO-377)', () => {
  it('maps a plain-text caret position inside a single run to the correct offsetInBlock', () => {
    const source = 'hello world';
    const blocks = classifyDocument(source);
    const { root, textNode } = buildParagraphDom(source, 0);

    const result = domPositionToBlockOffset(textNode, 5, blocks);

    expect(result).not.toBeNull();
    expect(result!.block.kind).toBe('paragraph');
    expect(result!.offsetInBlock).toBe(5);
    void root;
  });

  it('maps an offset inside a bold run back to the absolute source offset, accounting for the ** prefix', () => {
    const source = 'a **bold** word';
    const blocks = classifyDocument(source);
    const block = blocks[0]!;

    const p = document.createElement('p');
    p.setAttribute('data-block-from', String(block.from));
    const runs = block.runs!;
    const textNodes = runs.map((run) => {
      const node = document.createTextNode(source.slice(run.from, run.to));
      p.appendChild(node);
      return node;
    });

    const boldTextNode = textNodes[1]!;
    const result = domPositionToBlockOffset(boldTextNode, 2, blocks);

    expect(result).not.toBeNull();
    // "**bold**" starts at source index 2; the '**' prefix is 2 chars, so DOM offset 2 inside "bold" is
    // absolute source offset 2 + 2 + 2 = 6, i.e. offsetInBlock 6 (this block's contentFrom is 0).
    expect(result!.offsetInBlock).toBe(6);
  });

  it('returns offsetInBlock 0 for an empty block with no text nodes', () => {
    const source = '#  ';
    const blocks = classifyDocument('# ');
    const block = blocks[0]!;
    const heading = document.createElement('h1');
    heading.setAttribute('data-block-from', String(block.from));

    const result = domPositionToBlockOffset(heading, 0, blocks);
    expect(result).not.toBeNull();
    expect(result!.offsetInBlock).toBe(0);
    void source;
  });

  it('returns null when the node has no ancestor with data-block-from', () => {
    const source = 'hello';
    const blocks = classifyDocument(source);
    const orphan = document.createTextNode('hello');
    expect(domPositionToBlockOffset(orphan, 2, blocks)).toBeNull();
  });
});

describe('blockOffsetToDomPosition (WO-377)', () => {
  it('is the inverse of domPositionToBlockOffset for a plain-text block', () => {
    const source = 'hello world';
    const blocks = classifyDocument(source);
    const block = blocks[0]!;
    const { root, textNode } = buildParagraphDom(source, 0);

    const position = blockOffsetToDomPosition(root, block, 5);

    expect(position).not.toBeNull();
    expect(position!.node).toBe(textNode);
    expect(position!.offset).toBe(5);
  });

  it('restores a cursor inside a bold run at the correct DOM offset', () => {
    const source = 'a **bold** word';
    const blocks = classifyDocument(source);
    const block = blocks[0]!;

    const p = document.createElement('p');
    p.setAttribute('data-block-from', String(block.from));
    const textNodes = block.runs!.map((run) => {
      const node = document.createTextNode(source.slice(run.from, run.to));
      p.appendChild(node);
      return node;
    });

    const position = blockOffsetToDomPosition(p, block, 6);

    expect(position).not.toBeNull();
    expect(position!.node).toBe(textNodes[1]);
    expect(position!.offset).toBe(2);
  });

  it('returns a position at the block element itself for an empty block', () => {
    const blocks = classifyDocument('# ');
    const block = blocks[0]!;
    const heading = document.createElement('h1');
    heading.setAttribute('data-block-from', String(block.from));

    const position = blockOffsetToDomPosition(heading, block, 0);
    expect(position).toEqual({ node: heading, offset: 0 });
  });
});
