/**
 * Vista previa content (WO-300 follow-up): each block is a `contentEditable` field rendering its
 * inline Markdown as real formatting (bold/italic/strikethrough/links), never literal `**`/`_`/
 * `~~`/`[]()`. The block model is always the source of truth: the DOM is only re-synced when the
 * incoming `block.text` did not originate from this same field's own edit (see `Block` below).
 */
import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { getPerson, type BlockType, type DocumentBlock } from '../../data';
import { htmlToInline, inlineToHtml } from './markdown';
import styles from './PreviewEditor.module.css';

export interface PreviewEditorProps {
  readonly blocks: readonly DocumentBlock[];
  readonly onFocusBlock: (id: string) => void;
  readonly onChangeText: (id: string, text: string) => void;
  readonly onToggleChecked: (id: string) => void;
  readonly onFormatShortcut: (marker: '**' | '_') => void;
  readonly onSelectionChange: (blockId: string) => void;
  readonly registerField: (id: string, element: HTMLDivElement | null) => void;
}

function gutterFor(block: DocumentBlock): { readonly text: string; readonly isAgent: boolean } {
  if (block.author === 'agent') {
    const acceptedBy = block.acceptedBy ? (getPerson(block.acceptedBy)?.name ?? block.acceptedBy) : undefined;
    return { text: acceptedBy ? `Agente (aceptado por ${acceptedBy})` : 'Agente', isAgent: true };
  }
  return { text: getPerson(block.author)?.initials ?? block.author, isAgent: false };
}

function orderedNumberAt(blocks: readonly DocumentBlock[], index: number): number {
  let count = 1;
  for (let cursor = index - 1; cursor >= 0 && blocks[cursor]?.type === 'ol'; cursor -= 1) count += 1;
  return count;
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
  readonly onChangeText: (id: string, text: string) => void;
  readonly onFormatShortcut: (marker: '**' | '_') => void;
  readonly onSelectionChange: (blockId: string) => void;
  readonly registerField: (id: string, element: HTMLDivElement | null) => void;
}

/** One contentEditable field. Syncs from `block.text` only when the DOM disagrees with it. */
function BlockField({ block, index, onFocusBlock, onChangeText, onFormatShortcut, onSelectionChange, registerField }: BlockFieldProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);

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
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'b') {
      event.preventDefault();
      onFormatShortcut('**');
    } else if (event.key.toLowerCase() === 'i') {
      event.preventDefault();
      onFormatShortcut('_');
    }
  }

  return (
    <div
      id={`block-field-${block.id}`}
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
      onInput={handleInput}
      onKeyUp={() => onSelectionChange(block.id)}
      onMouseUp={() => onSelectionChange(block.id)}
      onKeyDown={handleKeyDown}
    />
  );
}

export function PreviewEditor({
  blocks,
  onFocusBlock,
  onChangeText,
  onToggleChecked,
  onFormatShortcut,
  onSelectionChange,
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
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={block.checked ?? false}
                onChange={() => onToggleChecked(block.id)}
                aria-label={`Tarea: ${block.text}`}
              />
            ) : null}
            <BlockField
              block={block}
              index={index}
              onFocusBlock={onFocusBlock}
              onChangeText={onChangeText}
              onFormatShortcut={onFormatShortcut}
              onSelectionChange={onSelectionChange}
              registerField={registerField}
            />
          </div>
        );
      })}
    </div>
  );
}
