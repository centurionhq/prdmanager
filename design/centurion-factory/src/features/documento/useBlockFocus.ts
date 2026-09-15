/**
 * Which preview field has focus, and moving focus/caret to a field a structural edit (split/merge/
 * paste) just created or resized. Extracted from EditorColumn (WO-319).
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { DocumentBlock } from '../../data';

export type FocusPosition = 'start' | 'end';

/** Collapses the caret to `position` inside `element` (used after a programmatic focus move). */
function placeCaretAt(element: HTMLElement, position: FocusPosition): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(position === 'start');
  selection.removeAllRanges();
  selection.addRange(range);
}

export interface UseBlockFocusOptions {
  readonly blocks: readonly DocumentBlock[];
}

export interface UseBlockFocusResult {
  readonly fieldsRef: MutableRefObject<Map<string, HTMLDivElement>>;
  readonly focusedBlockId: string | undefined;
  readonly focusedBlock: DocumentBlock | undefined;
  readonly hasBlockFocus: boolean;
  readonly setHasBlockFocus: (value: boolean) => void;
  readonly handleFocusBlock: (blockId: string) => void;
  readonly requestFocus: (id: string, position: FocusPosition) => void;
}

export function useBlockFocus({ blocks }: UseBlockFocusOptions): UseBlockFocusResult {
  const [focusedBlockId, setFocusedBlockId] = useState<string | undefined>(blocks[0]?.id);
  const [hasBlockFocus, setHasBlockFocus] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ readonly id: string; readonly position: FocusPosition } | null>(null);
  const fieldsRef = useRef(new Map<string, HTMLDivElement>());

  const focusedBlock = blocks.find((block) => block.id === focusedBlockId);

  // A split/merge/paste creates or removes a field: focus its element once React has mounted it.
  useEffect(() => {
    if (!focusRequest) return;
    const element = fieldsRef.current.get(focusRequest.id);
    if (element) {
      element.focus();
      placeCaretAt(element, focusRequest.position);
      setFocusedBlockId(focusRequest.id);
      setHasBlockFocus(true);
    }
    setFocusRequest(null);
  }, [focusRequest]);

  function handleFocusBlock(blockId: string): void {
    setFocusedBlockId(blockId);
    setHasBlockFocus(true);
  }

  function requestFocus(id: string, position: FocusPosition): void {
    setFocusRequest({ id, position });
  }

  return { fieldsRef, focusedBlockId, focusedBlock, hasBlockFocus, setHasBlockFocus, handleFocusBlock, requestFocus };
}
