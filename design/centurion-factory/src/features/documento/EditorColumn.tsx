/**
 * Editor column: preview-first tabs ("Vista previa" default, "Markdown") over the block model.
 * Vista previa renders real WYSIWYG formatting (bold/italic/strikethrough/links); the block model
 * is always the source of truth, and the Markdown tab re-parses into it on switching back.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { BlockType, DocumentBlock } from '../../data';
import { blocksForPaste, mergeIntoPrevious, splitBlock, splitFieldAtCaret } from './blockEditing';
import { findAncestorWithTag, normalizeFormatting, unwrapElement } from './domFormatting';
import styles from './EditorColumn.module.css';
import { MarkdownEditor } from './MarkdownEditor';
import { htmlToInline, sanitizeHref } from './markdown';
import { PreviewEditor } from './PreviewEditor';
import { Toolbar, type InlineFormat } from './Toolbar';
import { CURRENT_USER_ID, type EditorMode } from './useDocumentEditor';

type FocusPosition = 'start' | 'end';

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

export interface EditorColumnProps {
  readonly blocks: readonly DocumentBlock[];
  readonly onBlocksChange: (next: readonly DocumentBlock[]) => void;
  readonly saveStatus: string;
  readonly mode: EditorMode;
  readonly onModeChange: (mode: EditorMode) => void;
  readonly markdownDraft: string;
  readonly onMarkdownDraftChange: (draft: string) => void;
  readonly markdownLineBlockIds: readonly (string | undefined)[];
}

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

export function EditorColumn({
  blocks,
  onBlocksChange,
  saveStatus,
  mode,
  onModeChange,
  markdownDraft,
  onMarkdownDraftChange,
  markdownLineBlockIds,
}: EditorColumnProps): ReactElement {
  const [focusedBlockId, setFocusedBlockId] = useState<string | undefined>(blocks[0]?.id);
  const [hasBlockFocus, setHasBlockFocus] = useState(false);
  const [activeFormats, setActiveFormats] = useState<ReadonlySet<InlineFormat>>(new Set());
  const [focusRequest, setFocusRequest] = useState<{ readonly id: string; readonly position: FocusPosition } | null>(null);
  const fieldsRef = useRef(new Map<string, HTMLDivElement>());
  const capturedLinkRangeRef = useRef<{ readonly blockId: string; readonly range: Range } | null>(null);

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

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onModeChange(mode === 'preview' ? 'markdown' : 'preview');
  }

  function updateBlock(id: string, patch: Partial<DocumentBlock>): void {
    onBlocksChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function handleSetBlockType(type: BlockType): void {
    if (!focusedBlockId) return;
    updateBlock(focusedBlockId, { type, checked: type === 'task' ? (focusedBlock?.checked ?? false) : undefined });
  }

  function refreshActiveFormats(blockId: string): void {
    const root = fieldsRef.current.get(blockId);
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) {
      setActiveFormats(new Set());
      return;
    }
    setActiveFormats(activeFormatsAt(selection.anchorNode, root));
  }

  function syncBlockFromDom(blockId: string, root: HTMLDivElement): void {
    updateBlock(blockId, { text: htmlToInline(root.innerHTML) });
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
    syncBlockFromDom(focusedBlockId, root);
    refreshActiveFormats(focusedBlockId);
  }

  // Enlace opens a popover whose URL input steals focus/selection, so the block's Range has to be
  // captured up front (on the toolbar button click) and reused once the URL is confirmed.
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
    capturedLinkRangeRef.current = { blockId: focusedBlockId, range };
  }

  function handleInsertLink(url: string): void {
    const captured = capturedLinkRangeRef.current;
    if (!captured) return;
    const root = fieldsRef.current.get(captured.blockId);
    if (!root) return;

    const anchor = document.createElement('a');
    anchor.setAttribute('href', sanitizeHref(url));
    anchor.setAttribute('rel', 'noopener noreferrer');
    if (captured.range.collapsed) {
      anchor.textContent = 'texto';
      captured.range.insertNode(anchor);
    } else {
      anchor.appendChild(captured.range.extractContents());
      captured.range.insertNode(anchor);
    }

    syncBlockFromDom(captured.blockId, root);
    capturedLinkRangeRef.current = null;
  }

  /** Escape (or Cancelar) in the Enlace popover: focus the block again with its selection restored. */
  function handleCancelLink(): void {
    const captured = capturedLinkRangeRef.current;
    capturedLinkRangeRef.current = null;
    if (!captured) return;
    const root = fieldsRef.current.get(captured.blockId);
    if (!root) return;

    root.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(captured.range);
    refreshActiveFormats(captured.blockId);
  }

  /** The field's root element and the caret Range inside it, if any (shared by Enter/Backspace/paste). */
  function fieldCaret(blockId: string): { readonly root: HTMLDivElement; readonly range: Range } | undefined {
    const root = fieldsRef.current.get(blockId);
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return undefined;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return undefined;
    return { root, range };
  }

  function handleSplitBlock(blockId: string): void {
    const target = blocks.find((block) => block.id === blockId);
    const caret = fieldCaret(blockId);
    if (!target || !caret) return;

    const fields = splitFieldAtCaret(caret.root, caret.range);
    const { updated, created } = splitBlock(target, fields, CURRENT_USER_ID);
    const index = blocks.findIndex((block) => block.id === blockId);
    const next = blocks.map((block) => (block.id === blockId ? updated : block));
    onBlocksChange([...next.slice(0, index + 1), created, ...next.slice(index + 1)]);
    setFocusRequest({ id: created.id, position: 'start' });
  }

  function handleMergeWithPrevious(blockId: string): void {
    const index = blocks.findIndex((block) => block.id === blockId);
    const target = blocks[index];
    const previous = index > 0 ? blocks[index - 1] : undefined;
    if (!target || !previous) return;

    const merged = mergeIntoPrevious(previous, target);
    onBlocksChange(blocks.filter((block) => block.id !== blockId).map((block) => (block.id === previous.id ? merged : block)));
    setFocusRequest({ id: previous.id, position: 'end' });
  }

  function handlePasteText(blockId: string, clipboardText: string): void {
    const target = blocks.find((block) => block.id === blockId);
    const caret = fieldCaret(blockId);
    if (!target || !caret) return;

    const fields = splitFieldAtCaret(caret.root, caret.range);
    const replacement = blocksForPaste(target, fields, clipboardText, CURRENT_USER_ID);
    const index = blocks.findIndex((block) => block.id === blockId);
    const next = [...blocks.slice(0, index), ...replacement, ...blocks.slice(index + 1)];
    onBlocksChange(next);
    const lastCreated = replacement[replacement.length - 1];
    if (lastCreated && lastCreated.id !== blockId) setFocusRequest({ id: lastCreated.id, position: 'end' });
  }

  const footerLeft = mode === 'preview' ? `Vista previa · ${blocks.length} bloques` : `Markdown · ${markdownDraft.split('\n').length} líneas`;

  return (
    <div className={styles.editor}>
      <div className={styles.tabBar} role="tablist" aria-label="Modo del editor" onKeyDown={handleTabKeyDown}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          className={mode === 'preview' ? styles.tabSelected : styles.tab}
          onClick={mode === 'markdown' ? () => onModeChange('preview') : undefined}
        >
          Vista previa
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'markdown'}
          className={mode === 'markdown' ? styles.tabSelected : styles.tab}
          onClick={mode === 'preview' ? () => onModeChange('markdown') : undefined}
        >
          Markdown
        </button>
      </div>

      {mode === 'preview' ? (
        <>
          <Toolbar
            blockType={focusedBlock?.type}
            activeFormats={activeFormats}
            onSetBlockType={handleSetBlockType}
            onFormatSelection={handleFormatSelection}
            onRequestLink={handleRequestLink}
            onInsertLink={handleInsertLink}
            onCancelLink={handleCancelLink}
            linkEnabled={hasBlockFocus}
          />
          <PreviewEditor
            blocks={blocks}
            onFocusBlock={handleFocusBlock}
            onBlurBlock={() => setHasBlockFocus(false)}
            onChangeText={(id, text) => updateBlock(id, { text })}
            onToggleChecked={(id) => updateBlock(id, { checked: !blocks.find((block) => block.id === id)?.checked })}
            onFormatShortcut={handleFormatSelection}
            onSelectionChange={refreshActiveFormats}
            onSplitBlock={handleSplitBlock}
            onMergeWithPrevious={handleMergeWithPrevious}
            onPasteText={handlePasteText}
            registerField={(id, element) => {
              if (element) fieldsRef.current.set(id, element);
              else fieldsRef.current.delete(id);
            }}
          />
        </>
      ) : (
        <MarkdownEditor value={markdownDraft} onChange={onMarkdownDraftChange} gutterBlocks={blocks} lineBlockIds={markdownLineBlockIds} />
      )}

      <div className={styles.footer}>
        <span className="num">{footerLeft}</span>
        <span>{saveStatus}</span>
      </div>
    </div>
  );
}
