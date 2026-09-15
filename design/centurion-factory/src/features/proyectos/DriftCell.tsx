import type { ReactElement } from 'react';
import type { ProjectSummary } from '../../data';
import { driftSummary, type DriftTone } from './lib';
import styles from './ProyectosPage.module.css';

const TONE_CLASS: Record<DriftTone, string | undefined> = {
  error: styles.driftError,
  warning: styles.driftWarning,
  ok: styles.driftOk,
  awaiting: styles.driftAwaiting,
};

const MARK_CLASS: Record<DriftTone, string | undefined> = {
  error: styles.markSquare,
  warning: styles.markDot,
  ok: styles.markSquare,
  awaiting: undefined,
};

export interface DriftCellProps {
  readonly project: Pick<ProjectSummary, 'driftErrors' | 'driftWarnings' | 'awaitingFirstReport'>;
}

/** Drift summary per project: paro/andon/señal mark plus label, or a muted "awaiting" note. */
export function DriftCell({ project }: DriftCellProps): ReactElement {
  const summary = driftSummary(project);
  const markClass = MARK_CLASS[summary.tone];
  const wrapperClass = [styles.driftCell, TONE_CLASS[summary.tone]].filter((value): value is string => Boolean(value)).join(' ');

  return (
    <span className={wrapperClass}>
      {markClass ? <span className={`${styles.mark} ${markClass}`} aria-hidden="true" /> : null}
      {summary.label}
    </span>
  );
}
