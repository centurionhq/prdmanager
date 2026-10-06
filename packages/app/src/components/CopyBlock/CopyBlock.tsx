/**
 * A block of literal text meant to be copied and run somewhere else (SDD-055/PRD-033 R4, canvas
 * `ConstruirDeveloper.dc.html`): commands, a config snippet, an identifier.
 *
 * The text is always rendered as real, selectable text — the copy button is a shortcut, never the only way
 * to get it. The clipboard itself (its failure message included) lives in `use-copy-to-clipboard`, shared
 * with every other copyable literal (WO-635).
 */
import type { ReactElement } from 'react';
import { COPY_FAILED_MESSAGE, copyButtonLabel, useCopyToClipboard } from './use-copy-to-clipboard.js';
import styles from './CopyBlock.module.css';

export interface CopyBlockProps {
  /** Accessible name of the block, e.g. "Comandos para vincular". */
  readonly label: string;
  /** Exactly what is shown and exactly what is copied. */
  readonly text: string;
}

export function CopyBlock({ label, text }: CopyBlockProps): ReactElement {
  const { state, copy } = useCopyToClipboard(text);

  return (
    <div role="group" aria-label={label} className={styles.block}>
      <pre className={styles.text}>
        <code>{text}</code>
      </pre>
      <div className={styles.side}>
        <button type="button" className={styles.copy} onClick={() => void copy()}>
          {copyButtonLabel(state)}
        </button>
      </div>
      {state === 'failed' ? (
        <p role="status" className={styles.failed}>
          {COPY_FAILED_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
