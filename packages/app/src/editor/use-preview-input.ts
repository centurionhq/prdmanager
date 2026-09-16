/**
 * Translates DOM input events into `edit-ops.ts` calls + `applySplice` (SDD-014 §"Editor de vista previa":
 * the model is the only source of truth) and restores the DOM caret once the resulting re-render lands.
 *
 * - `beforeinput` (WO-377): always prevented, translated per `inputType`
 *   (`insertText`/`insertParagraph`/`deleteContentBackward`/`deleteContentForward`), except while an IME
 *   composition is in progress (see below).
 * - Composition (WO-378): intermediate `beforeinput` events during a composition are noisy and inconsistent
 *   across browsers/IMEs, so they're ignored entirely; instead, `compositionend` diffs the active block's
 *   live `textContent` against what it was at `compositionstart` and applies the difference as one splice.
 * - Paste (WO-378): only `text/plain` from the clipboard, escaped, ever reaches the model — clipboard HTML
 *   is never used.
 * - Drop (WO-378): unconditionally prevented; dragging content into the editor is not supported.
 * - A `MutationObserver` (WO-378) reverts any DOM mutation that wasn't part of this hook's own
 *   render-triggered commit or an in-progress composition — nothing external is ever allowed to leave the
 *   DOM out of sync with `ytext`. Own-render mutations are discarded via `observer.takeRecords()` inside
 *   a `useLayoutEffect` that runs synchronously right after every commit — *not* via a timing flag reset
 *   through `queueMicrotask`, since the installed jsdom/Node delivers `MutationObserver` callbacks with
 *   higher priority than an already-scheduled `queueMicrotask` callback (confirmed empirically: a
 *   `queueMicrotask` call made strictly before `MutationObserver.observe()` still ran *after* that
 *   observer's callback once a mutation queued it), so a flag reset that way can't be trusted to have run
 *   before the observer's callback fires.
 *
 * Registers *native* `addEventListener`s on the container DOM node rather than React's synthetic props:
 * React's `onBeforeInput` predates the real DOM event and is synthesized from
 * `compositionend`/`keypress`/`textInput` instead (confirmed against the installed react-dom's own event
 * plugin source) — it never fires from an actual native `beforeinput` event, which is the only thing a real
 * contentEditable browser (or this WO's own tests) ever dispatches.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import * as Y from 'yjs';
import type { SourceBlock } from './source-map.js';
import { classifyCached } from './parse-cache.js';
import { deleteRange, escapeMarkdownText, insertText, joinBlocks, splitBlock, type Splice } from './edit-ops.js';
import { applySplice } from './y-binding.js';
import { blockOffsetToDomPosition, domPositionToBlockOffset, type BlockDomPosition } from './dom-selection.js';
import { displayOffsetToSourceOffset } from './run-text.js';
import { diffText } from './composition-diff.js';
import { revertMutationRecords } from './dom-mutation-guard.js';

export interface UsePreviewInputOptions {
  ytext: Y.Text;
  containerRef: RefObject<HTMLElement | null>;
  readOnly: boolean;
}

interface CompositionBaseline {
  blockElement: Element;
  textBefore: string;
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

function closestBlockElement(node: Node): Element | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return element?.closest('[data-block-from]') ?? null;
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

function resolveSelectionPositions(blocks: readonly SourceBlock[]): { start: BlockDomPosition; end: BlockDomPosition } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = domPositionToBlockOffset(range.startContainer, range.startOffset, blocks);
  const end = domPositionToBlockOffset(range.endContainer, range.endOffset, blocks);
  if (!start || !end) return null;
  return { start, end };
}

const MUTATION_OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeOldValue: true,
  characterData: true,
  characterDataOldValue: true,
};

export function usePreviewInput({ ytext, containerRef, readOnly }: UsePreviewInputOptions): void {
  const pendingCursorAbsoluteOffset = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);
  const compositionBaselineRef = useRef<CompositionBaseline | null>(null);

  useLayoutEffect(() => {
    // Discards whatever mutation records this render's own DOM commit just produced, synchronously,
    // before the observer's (always asynchronous) callback ever gets a chance to see them.
    observerRef.current?.takeRecords();

    const target = pendingCursorAbsoluteOffset.current;
    const container = containerRef.current;
    pendingCursorAbsoluteOffset.current = null;
    if (target === null || !container) return;

    const source = ytext.toString();
    const block = findBlockAt(classifyCached(ytext, source), target);
    if (!block) return;

    const position = blockOffsetToDomPosition(container, block, target - block.contentFrom);
    if (!position) return;

    window.getSelection()?.setBaseAndExtent(position.node, position.offset, position.node, position.offset);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const applyModelSplice = (splice: Splice | null): void => {
      if (!splice) return;
      pendingCursorAbsoluteOffset.current = splice.from + splice.insert.length;
      applySplice(ytext, splice);
    };

    const handleBeforeInput = (event: InputEvent): void => {
      if (isComposingRef.current) return;
      event.preventDefault();
      if (readOnly) return;

      const source = ytext.toString();
      const blocks = classifyCached(ytext, source);
      const positions = resolveSelectionPositions(blocks);
      if (!positions) return;

      applyModelSplice(buildSplice(event.inputType, event.data, positions.start, positions.end, blocks, source));
    };

    const handleCompositionStart = (event: CompositionEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const blockElement = closestBlockElement(target);
      if (!blockElement) return;
      isComposingRef.current = true;
      compositionBaselineRef.current = { blockElement, textBefore: blockElement.textContent ?? '' };
    };

    const handleCompositionEnd = (): void => {
      isComposingRef.current = false;
      const baseline = compositionBaselineRef.current;
      compositionBaselineRef.current = null;
      if (!baseline || readOnly) return;

      const textAfter = baseline.blockElement.textContent ?? '';
      const diff = diffText(baseline.textBefore, textAfter);
      if (diff.deleteCount === 0 && diff.insertText.length === 0) return;

      const blockFrom = Number(baseline.blockElement.getAttribute('data-block-from'));
      const source = ytext.toString();
      const block = classifyCached(ytext, source).find((candidate) => candidate.from === blockFrom);
      if (!block) return;

      const from = displayOffsetToSourceOffset(source, block, diff.start);
      const to = displayOffsetToSourceOffset(source, block, diff.start + diff.deleteCount);
      applyModelSplice({ from, to, insert: escapeMarkdownText(diff.insertText) });
    };

    const handlePaste = (event: ClipboardEvent): void => {
      event.preventDefault();
      if (readOnly) return;

      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text) return;

      const source = ytext.toString();
      const blocks = classifyCached(ytext, source);
      const positions = resolveSelectionPositions(blocks);
      if (!positions) return;

      const { start, end } = positions;
      const isCollapsed = start.block.from === end.block.from && start.offsetInBlock === end.offsetInBlock;
      applyModelSplice(isCollapsed ? insertText(start.block, start.offsetInBlock, text, source) : buildRangeReplace(start, end, text, source));
    };

    const handleDrop = (event: DragEvent): void => {
      event.preventDefault();
    };

    const handleMutations = (records: MutationRecord[]): void => {
      if (isComposingRef.current) return;
      // Disconnected around the revert itself: removeChild/insertBefore/setAttribute below are themselves
      // mutations, and this same observer (subtree: true) would otherwise re-queue and re-deliver them,
      // undoing its own revert forever.
      observer.disconnect();
      revertMutationRecords(records);
      observer.observe(container, MUTATION_OBSERVER_OPTIONS);
    };

    const observer = new MutationObserver(handleMutations);
    observer.observe(container, MUTATION_OBSERVER_OPTIONS);
    observerRef.current = observer;

    container.addEventListener('beforeinput', handleBeforeInput);
    container.addEventListener('compositionstart', handleCompositionStart);
    container.addEventListener('compositionend', handleCompositionEnd);
    container.addEventListener('paste', handlePaste as EventListener);
    container.addEventListener('drop', handleDrop as EventListener);

    return () => {
      observerRef.current = null;
      observer.disconnect();
      container.removeEventListener('beforeinput', handleBeforeInput);
      container.removeEventListener('compositionstart', handleCompositionStart);
      container.removeEventListener('compositionend', handleCompositionEnd);
      container.removeEventListener('paste', handlePaste as EventListener);
      container.removeEventListener('drop', handleDrop as EventListener);
    };
  }, [ytext, readOnly, containerRef]);
}
