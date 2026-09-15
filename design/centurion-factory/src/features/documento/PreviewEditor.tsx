/**
 * Vista previa content (WO-300): each block is a controlled, single-line text field styled per
 * its type, with an author gutter (initials or the Agente mark) and a bullet/number/checkbox
 * marker. Keyboard-accessible per the shared convention: every control is a native form element.
 */
import type { ChangeEvent, ReactElement } from 'react';
import { getPerson, type DocumentBlock } from '../../data';
import styles from './PreviewEditor.module.css';

export interface PreviewEditorProps {
  readonly blocks: readonly DocumentBlock[];
  readonly onFocusBlock: (id: string) => void;
  readonly onChangeText: (id: string, text: string) => void;
  readonly onToggleChecked: (id: string) => void;
  readonly registerField: (id: string, element: HTMLInputElement | null) => void;
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

const TYPE_CLASS: Record<DocumentBlock['type'], string> = {
  h1: styles.h1 ?? '',
  h2: styles.h2 ?? '',
  h3: styles.h3 ?? '',
  p: styles.p ?? '',
  li: styles.p ?? '',
  ol: styles.p ?? '',
  task: styles.p ?? '',
};

export function PreviewEditor({ blocks, onFocusBlock, onChangeText, onToggleChecked, registerField }: PreviewEditorProps): ReactElement {
  function handleChange(id: string, event: ChangeEvent<HTMLInputElement>): void {
    onChangeText(id, event.target.value);
  }

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
            <label className="visually-hidden" htmlFor={`block-field-${block.id}`}>
              {`Texto del bloque ${index + 1}`}
            </label>
            <input
              id={`block-field-${block.id}`}
              ref={(element) => registerField(block.id, element)}
              className={`${styles.field} ${TYPE_CLASS[block.type]}`}
              value={block.text}
              onFocus={() => onFocusBlock(block.id)}
              onChange={(event) => handleChange(block.id, event)}
            />
          </div>
        );
      })}
    </div>
  );
}
