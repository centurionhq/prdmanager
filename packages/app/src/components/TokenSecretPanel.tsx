/**
 * Shown exactly once, immediately after a token is created (SDD-006 §Modelo de datos: "el secreto se
 * muestra una sola vez"): `secret` only ever lives in this component's own render — never written to
 * `localStorage`/a cookie/anywhere persistent, and the server itself never lets it be re-fetched
 * (`tokenSummarySchema` has no secret field). Dismissing it drops the last reference React holds.
 */
import { useState, type ReactElement } from 'react';
import styles from '../styles/forms.module.css';

export function TokenSecretPanel({ secret, onDismiss }: { secret: string; onDismiss: () => void }): ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // Clipboard access can be denied/unavailable (permissions, non-secure context in some browsers);
      // the secret is still selectable/copyable by hand from the panel below.
    }
  }

  return (
    <div className={styles.secretPanel} role="alert">
      <p className={styles.secretTitle}>Guardá este secreto ahora: no se va a volver a mostrar.</p>
      <code className={styles.secretValue}>{secret}</code>
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={() => void handleCopy()}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
        <button type="button" className={styles.primaryButton} onClick={onDismiss}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
