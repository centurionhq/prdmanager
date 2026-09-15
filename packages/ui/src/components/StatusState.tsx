import type { ReactElement } from 'react';
import styles from './StatusState.module.css';

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido';
}

/** `role="status"`/`aria-live="polite"` so a screen reader announces the transition without stealing focus. */
export function LoadingState({ label = 'Cargando…' }: { label?: string }): ReactElement {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }): ReactElement {
  return (
    <div className={styles.wrap} role="alert">
      <svg className={styles.errorIcon} width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1 15 14H1Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 6v3.4M8 11.6v.1" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <span>No se pudo cargar</span>
      <span className={styles.errorMessage}>{messageFor(error)}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function EmptyState({ label }: { label: string }): ReactElement {
  return (
    <div className={styles.wrap}>
      <span>{label}</span>
    </div>
  );
}
