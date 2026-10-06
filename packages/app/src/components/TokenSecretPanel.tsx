/**
 * Shown exactly once, immediately after a token is created (SDD-006 §Modelo de datos: "el secreto se
 * muestra una sola vez"): `secret` only ever lives in this component's own render — never written to
 * `localStorage`/a cookie/anywhere persistent, and the server itself never lets it be re-fetched
 * (`tokenSummarySchema` has no secret field). Dismissing it drops the last reference React holds.
 *
 * SDD-056/PRD-036: drawn as the canvas's own card ("Token creado", `AjustesTokens.dc.html`) with the design
 * system's `CopyBlock`, which also covers a browser that refuses the clipboard. It is `role="alert"` so a
 * screen reader announces it the moment it appears: the secret cannot be recovered if it is missed.
 */
import type { ReactElement } from 'react';
import { Button, CopyBlock } from './index.js';
import styles from './TokenSecretPanel.module.css';

export function TokenSecretPanel({ secret, onDismiss }: { secret: string; onDismiss: () => void }): ReactElement {
  return (
    <div className={styles.panel} role="alert">
      <span className={styles.title}>Token creado</span>
      <p className={styles.text}>Copialo ahora. Por seguridad no lo vamos a volver a mostrar.</p>
      <CopyBlock label="Token recién creado" text={secret} />
      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={onDismiss}>
          Ya lo guardé
        </Button>
      </div>
    </div>
  );
}
