/**
 * Editor column: preview-first tabs ("Vista previa" default, "Markdown") over the block model.
 * Vista previa renders real WYSIWYG formatting (bold/italic/strikethrough/links); the block model
 * is always the source of truth, and the Markdown tab re-parses into it on switching back.
 */
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { BlockType, DocumentBlock } from '../../data';
import styles from './EditorColumn.module.css';
import { MarkdownEditor } from './MarkdownEditor';
import { htmlToInline, parseMarkdown, reconcileBlocks, sanitizeHref, serializeBlocks } from './markdown';
import { PreviewEditor } from './PreviewEditor';
import { Toolbar, type InlineFormat } from './Toolbar';
import { CURRENT_USER_ID } from './useDocumentEditor';

export interface EditorColumnProps {
  readonly blocks: readonly DocumentBlock[];
  readonly onBlocksChange: (next: readonly DocumentBlock[]) => void;
  readonly saveStatus: string;
}

type EditorMode = 'preview' | 'markdown';

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

export function EditorColumn({ blocks, onBlocksChange, saveStatus }: EditorColumnProps): ReactElement {
  const [mode, setMode] = useState<EditorMode>('preview');
  const [focusedBlockId, setFocusedBlockId] = useState<string | undefined>(blocks[0]?.id);
  const [activeFormats, setActiveFormats] = useState<ReadonlySet<InlineFormat>>(new Set());
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [markdownGutterBlocks, setMarkdownGutterBlocks] = useState<readonly DocumentBlock[]>(blocks);
  const fieldsRef = useRef(new Map<string, HTMLDivElement>());
  const capturedLinkRangeRef = useRef<{ readonly blockId: string; readonly range: Range } | null>(null);

  const focusedBlock = blocks.find((block) => block.id === focusedBlockId);

  function switchToMarkdown(): void {
    setMarkdownDraft(serializeBlocks(blocks));
    setMarkdownGutterBlocks(blocks);
    setMode('markdown');
  }

  function switchToPreview(): void {
    const parsed = parseMarkdown(markdownDraft);
    onBlocksChange(reconcileBlocks(blocks, parsed, CURRENT_USER_ID));
    setMode('preview');
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (mode === 'preview') switchToMarkdown();
    else switchToPreview();
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

    const wrapper = document.createElement(FORMAT_TAG[marker]);
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);

    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selection.addRange(nextRange);

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

  const footerLeft = mode === 'preview' ? `Vista previa · ${blocks.length} bloques` : `Markdown · ${markdownDraft.split('\n').length} líneas`;

  return (
    <div className={styles.editor}>
      <div className={styles.tabBar} role="tablist" aria-label="Modo del editor" onKeyDown={handleTabKeyDown}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          className={mode === 'preview' ? styles.tabSelected : styles.tab}
          onClick={mode === 'markdown' ? switchToPreview : undefined}
        >
          Vista previa
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'markdown'}
          className={mode === 'markdown' ? styles.tabSelected : styles.tab}
          onClick={mode === 'preview' ? switchToMarkdown : undefined}
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
          />
          <PreviewEditor
            blocks={blocks}
            onFocusBlock={setFocusedBlockId}
            onChangeText={(id, text) => updateBlock(id, { text })}
            onToggleChecked={(id) => updateBlock(id, { checked: !blocks.find((block) => block.id === id)?.checked })}
            onFormatShortcut={handleFormatSelection}
            onSelectionChange={refreshActiveFormats}
            registerField={(id, element) => {
              if (element) fieldsRef.current.set(id, element);
              else fieldsRef.current.delete(id);
            }}
          />
        </>
      ) : (
        <MarkdownEditor value={markdownDraft} onChange={setMarkdownDraft} gutterBlocks={markdownGutterBlocks} />
      )}

      <div className={styles.footer}>
        <span className="num">{footerLeft}</span>
        <span>{saveStatus}</span>
      </div>
    </div>
  );
}
