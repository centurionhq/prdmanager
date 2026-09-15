/**
 * Editor column: a per-block author gutter over a plain Markdown textarea. WO-289 adds the
 * gutter (so an accepted agent edit shows "Agente (aceptado por Ana Ríos)"); WO-300 replaces the
 * textarea with the full preview-first, block-model editor synced to a Markdown tab.
 */
import type { ReactElement } from 'react';
import { getPerson, type DocumentBlock } from '../../data';
import styles from './EditorColumn.module.css';

export interface EditorColumnProps {
  readonly blocks: readonly DocumentBlock[];
}

function gutterLabel(block: DocumentBlock): { readonly text: string; readonly isAgent: boolean } {
  if (block.author === 'agent') {
    const acceptedBy = block.acceptedBy ? getPerson(block.acceptedBy)?.name ?? block.acceptedBy : undefined;
    return { text: acceptedBy ? `Agente (aceptado por ${acceptedBy})` : 'Agente', isAgent: true };
  }
  return { text: getPerson(block.author)?.initials ?? block.author, isAgent: false };
}

export function EditorColumn({ blocks }: EditorColumnProps): ReactElement {
  const text = blocks.map((block) => block.text).join('\n\n');

  return (
    <div className={styles.editor}>
      <ul className={styles.gutterList} aria-label="Autoría por bloque">
        {blocks.map((block) => {
          const gutter = gutterLabel(block);
          return (
            <li key={block.id} className={styles.gutterRow}>
              {gutter.isAgent ? (
                <span className={styles.gutterAgent} aria-label={gutter.text}>
                  Agente
                </span>
              ) : (
                <span className={styles.gutterAuthor}>{gutter.text}</span>
              )}
              <span className={styles.gutterText}>{block.text}</span>
            </li>
          );
        })}
      </ul>
      <label className="visually-hidden" htmlFor="documento-markdown-placeholder">
        Contenido del documento en Markdown
      </label>
      <textarea id="documento-markdown-placeholder" className={styles.textarea} value={text} readOnly />
    </div>
  );
}
