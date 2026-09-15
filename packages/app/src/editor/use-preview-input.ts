/**
 * Translates `beforeinput` (SDD-014 §"Editor de vista previa": always `preventDefault`, the model is the
 * only source of truth) into a single `edit-ops.ts` call + `applySplice`, and restores the DOM caret at the
 * equivalent position once the resulting re-render lands. Only the input types WO-377 calls out are
 * handled here (`insertText`, `deleteContentBackward`, `deleteContentForward`, `insertParagraph`);
 * composition/paste/drop are WO-378's.
 *
 * Registers a *native* `addEventListener('beforeinput', ...)` on the container DOM node rather than using
 * React's `onBeforeInput` prop: React's synthetic `onBeforeInput` predates the real DOM event and is
 * synthesized from `compositionend`/`keypress`/`textInput` instead (confirmed against the installed
 * react-dom's own event plugin source) — it never fires from an actual native `beforeinput` event, which is
 * the only thing a real contentEditable browser (or this WO's own tests) ever dispatches.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import * as Y from 'yjs';
import { classifyDocument, type SourceBlock } from './source-map.js';
import { deleteRange, insertText, joinBlocks, splitBlock, type Splice } from './edit-ops.js';
import { applySplice } from './y-binding.js';
import { blockOffsetToDomPosition, domPositionToBlockOffset, type BlockDomPosition } from './dom-selection.js';

export interface UsePreviewInputOptions {
  ytext: Y.Text;
  containerRef: RefObject<HTMLElement | null>;
  readOnly: boolean;
}

function findBlockAt(blocks: readonly SourceBlock[], absoluteOffset: number): SourceBlock | null {
  return (
    blocks.find((block) => absoluteOffset >= block.contentFrom && absoluteOffset <= block.to) ??
    blocks.find((block) => absoluteOffset >= block.from && absoluteOffset <= block.to) ??
    null
  );
}

function blockIndexOf(blocks: readonly SourceBlock[], block: SourceBlock): number {
  return blocks.findIndex((candidate) => candidate.from === block.from);
}

function buildBackwardDelete(position: BlockDomPosition, blocks: readonly SourceBlock[], source: string): Splice | null {
  if (position.offsetInBlock > 0) {
    return deleteRange(position.block, position.offsetInBlock - 1, position.offsetInBlock, source);
  }
  const index = blockIndexOf(blocks, position.block);
  const previousBlock = index > 0 ? blocks[index - 1] : undefined;
  if (!previousBlock || previousBlock.kind === 'island' || position.block.kind === 'island') return null;
  return joinBlocks(previousBlock, position.block, source.slice(previousBlock.to, position.block.from));
}

function buildForwardDelete(position: BlockDomPosition, blocks: readonly SourceBlock[], source: string): Splice | null {
  const blockLength = position.block.to - position.block.contentFrom;
  if (position.offsetInBlock < blockLength) {
    return deleteRange(position.block, position.offsetInBlock, position.offsetInBlock + 1, source);
  }
  const index = blockIndexOf(blocks, position.block);
  const nextBlock = blocks[index + 1];
  if (!nextBlock || nextBlock.kind === 'island' || position.block.kind === 'island') return null;
  return joinBlocks(position.block, nextBlock, source.slice(position.block.to, nextBlock.from));
}

function buildRangeReplace(start: BlockDomPosition, end: BlockDomPosition, data: string, source: string): Splice | null {
  if (start.block.from !== end.block.from) return null;
  const deleteSplice = deleteRange(start.block, start.offsetInBlock, end.offsetInBlock, source);
  const insertSplice = insertText(start.block, start.offsetInBlock, data, source);
  return { from: deleteSplice.from, to: deleteSplice.to, insert: insertSplice.insert };
}

function buildSplice(inputType: string, data: string | null, start: BlockDomPosition, end: BlockDomPosition, blocks: readonly SourceBlock[], source: string): Splice | null {
  const isCollapsed = start.block.from === end.block.from && start.offsetInBlock === end.offsetInBlock;

  if (!isCollapsed) {
    if (inputType === 'insertText') return buildRangeReplace(start, end, data ?? '', source);
    if (start.block.from !== end.block.from) return null;
    return deleteRange(start.block, start.offsetInBlock, end.offsetInBlock, source);
  }

  switch (inputType) {
    case 'insertText':
      return data ? insertText(start.block, start.offsetInBlock, data, source) : null;
    case 'insertParagraph':
      return splitBlock(start.block, start.offsetInBlock, source);
    case 'deleteContentBackward':
      return buildBackwardDelete(start, blocks, source);
    case 'deleteContentForward':
      return buildForwardDelete(start, blocks, source);
    default:
      return null;
  }
}

export function usePreviewInput({ ytext, containerRef, readOnly }: UsePreviewInputOptions): void {
  const pendingCursorAbsoluteOffset = useRef<number | null>(null);

  useLayoutEffect(() => {
    const target = pendingCursorAbsoluteOffset.current;
    const container = containerRef.current;
    pendingCursorAbsoluteOffset.current = null;
    if (target === null || !container) return;

    const source = ytext.toString();
    const block = findBlockAt(classifyDocument(source), target);
    if (!block) return;

    const position = blockOffsetToDomPosition(container, block, target - block.contentFrom);
    if (!position) return;

    window.getSelection()?.setBaseAndExtent(position.node, position.offset, position.node, position.offset);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleBeforeInput = (event: InputEvent): void => {
      event.preventDefault();
      if (readOnly) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);

      const source = ytext.toString();
      const blocks = classifyDocument(source);
      const start = domPositionToBlockOffset(range.startContainer, range.startOffset, blocks);
      const end = domPositionToBlockOffset(range.endContainer, range.endOffset, blocks);
      if (!start || !end) return;

      const splice = buildSplice(event.inputType, event.data, start, end, blocks, source);
      if (!splice) return;

      pendingCursorAbsoluteOffset.current = splice.from + splice.insert.length;
      applySplice(ytext, splice);
    };

    container.addEventListener('beforeinput', handleBeforeInput);
    return () => container.removeEventListener('beforeinput', handleBeforeInput);
  }, [ytext, readOnly, containerRef]);
}
