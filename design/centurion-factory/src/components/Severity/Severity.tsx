import type { ReactElement } from 'react';
import styles from './Severity.module.css';

export type SeverityLevel = 'error' | 'warning';

export interface SeverityProps {
  readonly severity: SeverityLevel;
  readonly label?: string;
}

const DEFAULT_LABEL: Record<SeverityLevel, string> = {
  error: 'Error',
  warning: 'Aviso',
};

/** Paro square for "Error" or andon dot for "Aviso", per the Componentes artboard. */
export function Severity({ severity, label }: SeverityProps): ReactElement {
  const toneClass = severity === 'error' ? styles.error : styles.warning;
  const markClass = severity === 'error' ? styles.markSquare : styles.markDot;

  return (
    <span className={[styles.severity, toneClass].join(' ')}>
      <span className={[styles.mark, markClass].join(' ')} aria-hidden="true" />
      {label ?? DEFAULT_LABEL[severity]}
    </span>
  );
}
