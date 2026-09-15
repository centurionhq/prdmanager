/**
 * Editor column placeholder (WO-287): a plain Markdown textarea. WO-300 replaces this with the
 * preview-first, block-model editor synced to a Markdown tab.
 */
import type { ReactElement } from 'react';
import type { DocumentBlock } from '../../data';
import styles from './EditorColumn.module.css';

export interface EditorColumnProps {
  readonly blocks: readonly DocumentBlock[];
}

export function EditorColumn({ blocks }: EditorColumnProps): ReactElement {
  const text = blocks.map((block) => block.text).join('\n\n');

  return (
    <div className={styles.editor}>
      <label className="visually-hidden" htmlFor="documento-markdown-placeholder">
        Contenido del documento en Markdown
      </label>
      <textarea id="documento-markdown-placeholder" className={styles.textarea} defaultValue={text} />
    </div>
  );
}
