/**
 * Enlace popover workflow: its URL input steals focus/selection, so the block's Range is captured
 * up front (on the toolbar button click) and reused once the URL is confirmed or the popover is
 * cancelled.
 */
import { useRef, type MutableRefObject } from 'react';
import { htmlToInline, sanitizeHref } from './markdown';

type CapturedRange = { readonly blockId: string; readonly range: Range };

/** Inserts `url` as a link around `range`'s contents (or as new "texto" if the range is collapsed). */
function insertLinkAtRange(range: Range, url: string): void {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', sanitizeHref(url));
  anchor.setAttribute('rel', 'noopener noreferrer');
  if (range.collapsed) {
    anchor.textContent = 'texto';
    range.insertNode(anchor);
  } else {
    anchor.appendChild(range.extractContents());
    range.insertNode(anchor);
  }
}

export interface UseLinkPopoverOptions {
  readonly fieldsRef: MutableRefObject<Map<string, HTMLDivElement>>;
  readonly focusedBlockId: string | undefined;
  readonly onSyncBlockText: (blockId: string, text: string) => void;
  readonly onAfterCancel: (blockId: string) => void;
}

export interface UseLinkPopoverResult {
  readonly handleRequestLink: () => void;
  readonly handleInsertLink: (url: string) => void;
  readonly handleCancelLink: () => void;
}

export function useLinkPopover({ fieldsRef, focusedBlockId, onSyncBlockText, onAfterCancel }: UseLinkPopoverOptions): UseLinkPopoverResult {
  const capturedRef = useRef<CapturedRange | null>(null);

  function handleRequestLink(): void {
    if (!focusedBlockId) return;
    const root = fieldsRef.current.get(focusedBlockId);
    const selection = window.getSelection();
    if (!root) return;

    const hasSelectionInBlock = Boolean(selection && selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).commonAncestorContainer));
    const range = hasSelectionInBlock ? selection!.getRangeAt(0).cloneRange() : document.createRange();
    if (!hasSelectionInBlock) {
      range.selectNodeContents(root);
      range.collapse(false);
    }
    capturedRef.current = { blockId: focusedBlockId, range };
  }

  function handleInsertLink(url: string): void {
    const captured = capturedRef.current;
    if (!captured) return;
    const root = fieldsRef.current.get(captured.blockId);
    if (!root) return;

    insertLinkAtRange(captured.range, url);
    onSyncBlockText(captured.blockId, htmlToInline(root.innerHTML));
    capturedRef.current = null;
  }

  function handleCancelLink(): void {
    const captured = capturedRef.current;
    capturedRef.current = null;
    if (!captured) return;
    const root = fieldsRef.current.get(captured.blockId);
    if (!root) return;

    root.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(captured.range);
    onAfterCancel(captured.blockId);
  }

  return { handleRequestLink, handleInsertLink, handleCancelLink };
}
