/**
 * Markdown tab (WO-300): a monospace textarea of the serialized blocks, with line numbers and a
 * best-effort author gutter (computed once from the blocks that were live when the tab opened).
 */
import { useId, type ChangeEvent, type ReactElement } from 'react';
import { getPerson, type DocumentBlock } from '../../data';
import styles from './MarkdownEditor.module.css';

export interface MarkdownEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly gutterBlocks: readonly DocumentBlock[];
}

/** One gutter entry per serialized line, aligned by index with `value.split('\n')`. */
function gutterLineAuthor(gutterBlocks: readonly DocumentBlock[], lineIndex: number): string {
  const block = gutterBlocks[lineIndex];
  if (!block) return '';
  if (block.author === 'agent') return 'Agente';
  return getPerson(block.author)?.initials ?? '';
}

export function MarkdownEditor({ value, onChange, gutterBlocks }: MarkdownEditorProps): ReactElement {
  const lines = value.split('\n');
  const textareaId = useId();

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    onChange(event.target.value);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.gutter} aria-hidden="true">
        {lines.map((_, index) => (
          <div key={index} className={styles.gutterRow}>
            <span className={styles.gutterAuthor}>{gutterLineAuthor(gutterBlocks, index)}</span>
            <span className="num">{index + 1}</span>
          </div>
        ))}
      </div>
      <label className="visually-hidden" htmlFor={textareaId}>
        Fuente en Markdown del documento
      </label>
      <textarea id={textareaId} className={`${styles.textarea} id`} value={value} onChange={handleChange} spellCheck={false} />
    </div>
  );
}
