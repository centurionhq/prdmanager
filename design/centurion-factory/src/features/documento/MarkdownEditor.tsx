/**
 * Markdown tab (WO-300): a monospace textarea of the serialized blocks, with line numbers and a
 * best-effort author gutter, computed once from the blocks that were live when the tab opened
 * (WO-312: aligned to each line's own block id, not to its raw index, so blank separator lines
 * between blocks don't shift every author down).
 */
import { useId, type ChangeEvent, type ReactElement } from 'react';
import { getPerson, type DocumentBlock } from '../../data';
import styles from './MarkdownEditor.module.css';

export interface MarkdownEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly gutterBlocks: readonly DocumentBlock[];
  /** `serializeBlocks`'s line -> block id map; a blank separator line has no owner. */
  readonly lineBlockIds: readonly (string | undefined)[];
}

function gutterLineAuthor(gutterBlocks: readonly DocumentBlock[], lineBlockIds: readonly (string | undefined)[], lineIndex: number): string {
  const blockId = lineBlockIds[lineIndex];
  const block = blockId ? gutterBlocks.find((candidate) => candidate.id === blockId) : undefined;
  if (!block) return '';
  if (block.author === 'agent') return 'Agente';
  return getPerson(block.author)?.initials ?? '';
}

export function MarkdownEditor({ value, onChange, gutterBlocks, lineBlockIds }: MarkdownEditorProps): ReactElement {
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
            <span className={styles.gutterAuthor}>{gutterLineAuthor(gutterBlocks, lineBlockIds, index)}</span>
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
