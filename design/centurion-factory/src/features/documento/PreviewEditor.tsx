/**
 * Vista previa content (WO-300 follow-up): each block is a `contentEditable` field rendering its
 * inline Markdown as real formatting (bold/italic/strikethrough/links), never literal `**`/`_`/
 * `~~`/`[]()`. The block model is always the source of truth: the DOM is only re-synced when the
 * incoming `block.text` did not originate from this same field's own edit (see `Block` below).
 */
import { useEffect, useId, useRef, type ClipboardEvent, type KeyboardEvent, type ReactElement } from 'react';
import { getPerson, type BlockType, type DocumentBlock } from '../../data';
import { htmlToInline, inlineToHtml, orderedNumberAt, plainText } from './markdown';
import styles from './PreviewEditor.module.css';

export interface PreviewEditorProps {
  readonly blocks: readonly DocumentBlock[];
  readonly onFocusBlock: (id: string) => void;
  readonly onBlurBlock: () => void;
  readonly onChangeText: (id: string, text: string) => void;
  readonly onToggleChecked: (id: string) => void;
  readonly onFormatShortcut: (marker: '**' | '_') => void;
  readonly onSelectionChange: (blockId: string) => void;
  readonly onSplitBlock: (blockId: string) => void;
  readonly onMergeWithPrevious: (blockId: string) => void;
  readonly onPasteText: (blockId: string, text: string) => void;
  readonly registerField: (id: string, element: HTMLDivElement | null) => void;
}

/** True when the caret (a collapsed selection) sits at the very first position inside `root`. */
function isCaretAtStart(root: HTMLElement, range: Range): boolean {
  if (!range.collapsed) return false;
  const probe = document.createRange();
  probe.setStart(root, 0);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length === 0;
}

function gutterFor(block: DocumentBlock): { readonly text: string; readonly isAgent: boolean } {
  if (block.author === 'agent') {
    const acceptedBy = block.acceptedBy ? (getPerson(block.acceptedBy)?.name ?? block.acceptedBy) : undefined;
    return { text: acceptedBy ? `Agente (aceptado por ${acceptedBy})` : 'Agente', isAgent: true };
  }
  return { text: getPerson(block.author)?.initials ?? block.author, isAgent: false };
}

const BLOCK_LABELS: Readonly<Record<BlockType, string>> = {
  h1: 'Título 1',
  h2: 'Título 2',
  h3: 'Título 3',
  p: 'Párrafo',
  li: 'Elemento de lista',
  ol: 'Elemento de lista numerada',
  task: 'Texto de la tarea',
};

const TYPE_CLASS: Record<BlockType, string> = {
  h1: styles.h1 ?? '',
  h2: styles.h2 ?? '',
  h3: styles.h3 ?? '',
  p: styles.p ?? '',
  li: styles.p ?? '',
  ol: styles.p ?? '',
  task: styles.p ?? '',
};

interface BlockFieldProps {
  readonly block: DocumentBlock;
  readonly index: number;
  readonly onFocusBlock: (id: string) => void;
  readonly onBlurBlock: () => void;
  readonly onChangeText: (id: string, text: string) => void;
  readonly onFormatShortcut: (marker: '**' | '_') => void;
  readonly onSelectionChange: (blockId: string) => void;
  readonly onSplitBlock: (blockId: string) => void;
  readonly onMergeWithPrevious: (blockId: string) => void;
  readonly onPasteText: (blockId: string, text: string) => void;
  readonly registerField: (id: string, element: HTMLDivElement | null) => void;
}

/** One contentEditable field. Syncs from `block.text` only when the DOM disagrees with it. */
function BlockField({
  block,
  index,
  onFocusBlock,
  onBlurBlock,
  onChangeText,
  onFormatShortcut,
  onSelectionChange,
  onSplitBlock,
  onMergeWithPrevious,
  onPasteText,
  registerField,
}: BlockFieldProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const currentModelText = htmlToInline(element.innerHTML);
    if (currentModelText !== block.text) {
      element.innerHTML = inlineToHtml(block.text);
    }
    // Runs once on mount (initial paint) and again only when an external change updates block.text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.text]);

  function handleInput(): void {
    const element = ref.current;
    if (!element) return;
    onChangeText(block.id, htmlToInline(element.innerHTML));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        onFormatShortcut('**');
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        onFormatShortcut('_');
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      onSplitBlock(block.id);
      return;
    }

    if (event.key === 'Backspace') {
      const element = ref.current;
      const selection = window.getSelection();
      if (!element || !selection || selection.rangeCount === 0) return;
      if (isCaretAtStart(element, selection.getRangeAt(0))) {
        event.preventDefault();
        onMergeWithPrevious(block.id);
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    event.preventDefault();
    onPasteText(block.id, event.clipboardData.getData('text/plain'));
  }

  return (
    <div
      id={`block-field-${fieldId}`}
      ref={(element) => {
        ref.current = element;
        registerField(block.id, element);
      }}
      role="textbox"
      aria-multiline={false}
      aria-label={`${BLOCK_LABELS[block.type]} ${index + 1}`}
      contentEditable
      suppressContentEditableWarning
      className={`${styles.field} ${TYPE_CLASS[block.type]}`}
      onFocus={() => {
        onFocusBlock(block.id);
        onSelectionChange(block.id);
      }}
      onBlur={onBlurBlock}
      onInput={handleInput}
      onKeyUp={() => onSelectionChange(block.id)}
      onMouseUp={() => onSelectionChange(block.id)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  );
}

export function PreviewEditor({
  blocks,
  onFocusBlock,
  onBlurBlock,
  onChangeText,
  onToggleChecked,
  onFormatShortcut,
  onSelectionChange,
  onSplitBlock,
  onMergeWithPrevious,
  onPasteText,
  registerField,
}: PreviewEditorProps): ReactElement {
  return (
    <div className={styles.content}>
      {blocks.map((block, index) => {
        const gutter = gutterFor(block);
        return (
          <div key={block.id} className={styles.row}>
            <span className={styles.gutter}>
              {gutter.isAgent ? (
                <span className={styles.agentMark} aria-label={gutter.text}>
                  Agente
                </span>
              ) : (
                gutter.text
              )}
            </span>
            {block.type === 'li' ? <span className={styles.bullet} aria-hidden="true" /> : null}
            {block.type === 'ol' ? <span className={`${styles.marker} num`}>{orderedNumberAt(blocks, index)}.</span> : null}
            {block.type === 'task' ? (
              <span className={styles.checkboxHitArea}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={block.checked ?? false}
                  onChange={() => onToggleChecked(block.id)}
                  aria-label={`Tarea: ${plainText(block.text)}`}
                />
              </span>
            ) : null}
            <BlockField
              block={block}
              index={index}
              onFocusBlock={onFocusBlock}
              onBlurBlock={onBlurBlock}
              onChangeText={onChangeText}
              onFormatShortcut={onFormatShortcut}
              onSelectionChange={onSelectionChange}
              onSplitBlock={onSplitBlock}
              onMergeWithPrevious={onMergeWithPrevious}
              onPasteText={onPasteText}
              registerField={registerField}
            />
          </div>
        );
      })}
    </div>
  );
}
