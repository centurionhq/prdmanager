/**
 * Tracks the live DOM selection inside the preview editor container as a `SourceBlock` plus
 * block-content-relative offsets — `Toolbar.tsx`'s own coordinate space, so it can call `edit-ops.ts`
 * functions directly with what this hook reports. Reuses `dom-selection.ts`'s `domPositionToBlockOffset`,
 * the same mapping `use-preview-input.ts` already relies on for `beforeinput`/paste handling.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { domPositionToBlockOffset } from './dom-selection.js';
import type { SourceBlock } from './source-map.js';

export interface ActiveSelection {
  block: SourceBlock;
  from: number;
  to: number;
}

/** `null` when the current selection isn't inside `container`, has no ranges, or spans more than one
 * block (cross-block formatting is out of scope — the toolbar simply has nothing to act on then). */
export function resolveActiveSelection(container: Element, blocks: readonly SourceBlock[]): ActiveSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const start = domPositionToBlockOffset(range.startContainer, range.startOffset, blocks);
  const end = domPositionToBlockOffset(range.endContainer, range.endOffset, blocks);
  if (!start || !end || start.block.from !== end.block.from) return null;

  const from = Math.min(start.offsetInBlock, end.offsetInBlock);
  const to = Math.max(start.offsetInBlock, end.offsetInBlock);
  return { block: start.block, from, to };
}

export interface UsePreviewSelectionOptions {
  containerRef: RefObject<HTMLElement | null>;
  blocks: readonly SourceBlock[];
}

function sameSelection(a: ActiveSelection | null, b: ActiveSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.block.from === b.block.from && a.from === b.from && a.to === b.to;
}

/** Re-resolves on every `selectionchange` — the only DOM event that fires for every way a selection can
 * change (click, drag, keyboard arrows, `Toolbar`'s own focus-preserving buttons). `blocks` is read from a
 * ref rather than the effect's own dependency array: `PreviewEditor` re-classifies the document (a brand
 * new array) on every render, and re-subscribing on every render — while also calling `setSelection`
 * synchronously from that same subscription — would otherwise loop forever. */
export function usePreviewSelection({ containerRef, blocks }: UsePreviewSelectionOptions): ActiveSelection | null {
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  useEffect(() => {
    const handleSelectionChange = (): void => {
      const container = containerRef.current;
      const next = container ? resolveActiveSelection(container, blocksRef.current) : null;
      setSelection((previous) => (sameSelection(previous, next) ? previous : next));
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    handleSelectionChange();
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [containerRef]);

  return selection;
}
