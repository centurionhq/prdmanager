/** TokensPage's one-time "Token creado" panel: shows the secret once, then dismisses forever. */
import { Check, Copy } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../../components';
import styles from './TokensPage.module.css';
import type { UseTokensStateResult } from './useTokensState';

export interface NewTokenSecretPanelProps {
  readonly tokens: UseTokensStateResult;
}

export function NewTokenSecretPanel({ tokens }: NewTokenSecretPanelProps): ReactElement | null {
  if (!tokens.newSecret) return null;

  return (
    <div role="status" className={styles.successPanel}>
      <div className={styles.successHeader}>
        <Check aria-hidden="true" size={20} className={styles.successIcon} />
        <span className={styles.successTitle}>Token creado</span>
      </div>
      <p className={styles.successBody}>Copiá el token ahora. Por seguridad no lo vamos a volver a mostrar.</p>
      <div className={styles.successRow}>
        <input ref={tokens.secretFieldRef} readOnly className={`id ${styles.secretField}`} value={tokens.newSecret.secret} />
        <Button type="button" variant="secondary" onClick={tokens.handleCopy}>
          <Copy aria-hidden="true" size={16} />
          Copiar
        </Button>
        <button type="button" className={styles.linkButton} onClick={tokens.dismissNewSecret}>
          Ya lo guardé
        </button>
      </div>
    </div>
  );
}
