/** Tracks which inline formats (Negrita/Cursiva/Tachado) wrap the current selection, and toggles them. */
import { useState, type MutableRefObject } from 'react';
import { findAncestorWithTag, normalizeFormatting, unwrapElement } from './domFormatting';
import { htmlToInline } from './markdown';
import type { InlineFormat } from './Toolbar';

const FORMAT_TAG: Readonly<Record<InlineFormat, 'strong' | 'em' | 'del'>> = { '**': 'strong', _: 'em', '~~': 'del' };

/** Walks up from `node` to `root`, collecting which of our three inline tags wrap it. */
function activeFormatsAt(node: Node | null, root: HTMLElement): ReadonlySet<InlineFormat> {
  const formats = new Set<InlineFormat>();
  let current: Node | null = node;
  while (current && current !== root.parentNode) {
    if (current.nodeType === 1 /* ELEMENT_NODE */) {
      const tag = (current as HTMLElement).tagName;
      if (tag === 'STRONG' || tag === 'B') formats.add('**');
      else if (tag === 'EM' || tag === 'I') formats.add('_');
      else if (tag === 'DEL' || tag === 'S') formats.add('~~');
    }
    if (current === root) break;
    current = current.parentNode;
  }
  return formats;
}

export interface UseActiveFormatsOptions {
  readonly fieldsRef: MutableRefObject<Map<string, HTMLDivElement>>;
  readonly focusedBlockId: string | undefined;
  readonly onSyncBlockText: (blockId: string, text: string) => void;
}

export interface UseActiveFormatsResult {
  readonly activeFormats: ReadonlySet<InlineFormat>;
  readonly refreshActiveFormats: (blockId: string) => void;
  readonly handleFormatSelection: (marker: InlineFormat) => void;
}

export function useActiveFormats({ fieldsRef, focusedBlockId, onSyncBlockText }: UseActiveFormatsOptions): UseActiveFormatsResult {
  const [activeFormats, setActiveFormats] = useState<ReadonlySet<InlineFormat>>(new Set());

  function refreshActiveFormats(blockId: string): void {
    const root = fieldsRef.current.get(blockId);
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) {
      setActiveFormats(new Set());
      return;
    }
    setActiveFormats(activeFormatsAt(selection.anchorNode, root));
  }

  function handleFormatSelection(marker: InlineFormat): void {
    if (!focusedBlockId) return;
    const root = fieldsRef.current.get(focusedBlockId);
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed || !root.contains(range.commonAncestorContainer)) return;

    const tagName = FORMAT_TAG[marker].toUpperCase();
    const activeAncestor = activeFormats.has(marker) ? findAncestorWithTag(selection.anchorNode, root, tagName) : null;

    if (activeAncestor) {
      // Already formatted: toggle off by unwrapping, instead of nesting a second identical tag.
      unwrapElement(activeAncestor);
    } else {
      const wrapper = document.createElement(FORMAT_TAG[marker]);
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);

      selection.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(wrapper);
      selection.addRange(nextRange);
    }

    normalizeFormatting(root);
    onSyncBlockText(focusedBlockId, htmlToInline(root.innerHTML));
    refreshActiveFormats(focusedBlockId);
  }

  return { activeFormats, refreshActiveFormats, handleFormatSelection };
}
