/**
 * Editor column (WO-300): preview-first tabs ("Vista previa" default, "Markdown") over the block
 * model. The block model is always the source of truth: the Markdown tab re-parses into it when
 * you switch back to Vista previa.
 */
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { BlockType, DocumentBlock } from '../../data';
import styles from './EditorColumn.module.css';
import { MarkdownEditor } from './MarkdownEditor';
import { parseMarkdown, reconcileBlocks, serializeBlocks } from './markdown';
import { PreviewEditor } from './PreviewEditor';
import { Toolbar } from './Toolbar';
import { CURRENT_USER_ID } from './useDocumentEditor';

export interface EditorColumnProps {
  readonly blocks: readonly DocumentBlock[];
  readonly onBlocksChange: (next: readonly DocumentBlock[]) => void;
  readonly saveStatus: string;
}

type EditorMode = 'preview' | 'markdown';

function wrapSelection(value: string, start: number, end: number, before: string, after = before): string {
  return `${value.slice(0, start)}${before}${value.slice(start, end)}${after}${value.slice(end)}`;
}

export function EditorColumn({ blocks, onBlocksChange, saveStatus }: EditorColumnProps): ReactElement {
  const [mode, setMode] = useState<EditorMode>('preview');
  const [focusedBlockId, setFocusedBlockId] = useState<string | undefined>(blocks[0]?.id);
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [markdownGutterBlocks, setMarkdownGutterBlocks] = useState<readonly DocumentBlock[]>(blocks);
  const fieldsRef = useRef(new Map<string, HTMLInputElement>());

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

  function handleFormatSelection(marker: '**' | '_' | '~~'): void {
    if (!focusedBlockId) return;
    const field = fieldsRef.current.get(focusedBlockId);
    if (!field || field.selectionStart === null || field.selectionEnd === null) return;
    const { selectionStart: start, selectionEnd: end, value } = field;
    if (start === end) return;
    updateBlock(focusedBlockId, { text: wrapSelection(value, start, end, marker) });
  }

  function handleInsertLink(url: string): void {
    if (!focusedBlockId) return;
    const field = fieldsRef.current.get(focusedBlockId);
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    const label = start === end ? 'texto' : field.value.slice(start, end);
    const nextText = `${field.value.slice(0, start)}[${label}](${url})${field.value.slice(end)}`;
    updateBlock(focusedBlockId, { text: nextText });
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
            onSetBlockType={handleSetBlockType}
            onFormatSelection={handleFormatSelection}
            onInsertLink={handleInsertLink}
          />
          <PreviewEditor
            blocks={blocks}
            onFocusBlock={setFocusedBlockId}
            onChangeText={(id, text) => updateBlock(id, { text })}
            onToggleChecked={(id) => updateBlock(id, { checked: !blocks.find((block) => block.id === id)?.checked })}
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
