/**
 * A block of literal text meant to be copied and run somewhere else (SDD-055/PRD-033 R4, canvas
 * `ConstruirDeveloper.dc.html`): commands, a config snippet, an identifier.
 *
 * The text is always rendered as real, selectable text — the copy button is a shortcut, never the only way
 * to get it. `navigator.clipboard` is absent in an insecure context and can be denied outright, so a failure
 * says what happened and points at selecting it by hand, instead of leaving someone believing they copied
 * something they did not (the one thing worse than no button).
 */
import { useEffect, useState, type ReactElement } from 'react';
import styles from './CopyBlock.module.css';

export interface CopyBlockProps {
  /** Accessible name of the block, e.g. "Comandos para vincular". */
  readonly label: string;
  /** Exactly what is shown and exactly what is copied. */
  readonly text: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyBlock({ label, text }: CopyBlockProps): ReactElement {
  const [state, setState] = useState<CopyState>('idle');

  // Showing "Copiado" under a different text than the one that was copied would be a lie the moment the
  // block is reused for another step.
  useEffect(() => setState('idle'), [text]);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <div role="group" aria-label={label} className={styles.block}>
      <pre className={styles.text}>
        <code>{text}</code>
      </pre>
      <div className={styles.side}>
        <button type="button" className={styles.copy} onClick={() => void handleCopy()}>
          {state === 'copied' ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {state === 'failed' ? (
        <p role="status" className={styles.failed}>
          No pudimos usar el portapapeles. Seleccionalo y copialo a mano.
        </p>
      ) : null}
    </div>
  );
}
