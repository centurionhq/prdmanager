import { AlertTriangle } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../Button/Button';
import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  readonly title: string;
  readonly body: string;
  readonly onRetry: () => void;
  readonly retryLabel?: string;
}

const DEFAULT_RETRY_LABEL = 'Reintentar';

/** "Estado de error" plate: a paro mark, role="alert", and a retry action. */
export function ErrorState({ title, body, onRetry, retryLabel = DEFAULT_RETRY_LABEL }: ErrorStateProps): ReactElement {
  return (
    <div className={styles.errorState} role="alert">
      <span className={styles.mark} aria-hidden="true">
        <AlertTriangle size={12} strokeWidth={3} className={styles.markIcon} />
      </span>
      <div className={styles.content}>
        <p className={styles.title}>{title}</p>
        <p className={styles.body}>{body}</p>
        <Button type="button" variant="secondary" onClick={onRetry} className={styles.retry}>
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}
