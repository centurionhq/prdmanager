import type { ReactElement } from 'react';
import type { RefreshReport } from '@prdm/core';
import { useSelection } from '../state/selection';
import styles from './DriftBanner.module.css';

export interface DriftBannerProps {
  report: RefreshReport;
}

function severityOf(report: RefreshReport): 'ok' | 'warning' | 'error' {
  if (report.issues.some((issue) => issue.severity === 'error')) return 'error';
  if (report.issues.length > 0) return 'warning';
  return 'ok';
}

const ICONS: Record<'ok' | 'warning' | 'error', ReactElement> = {
  ok: (
    <svg className={styles.icon} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.5 5 9l5-6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  warning: (
    <svg className={styles.icon} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1 11.5 11h-11Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 4.6v2.8M6 8.8v.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  error: (
    <svg className={styles.icon} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 3.4v3M6 8.4v.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
};

/**
 * `components/DriftBanner.tsx` (SDD-005 "Frontend"): the system-status readout — green when `/api/drift` reports
 * zero issues, amber for warnings (e.g. an `impacts_paths` glob matching nothing), red once any issue is
 * `severity: 'error'` (SDD-002's own drift kinds). Clicking an issue's node id selects it, same as everywhere else.
 */
export function DriftBanner({ report }: DriftBannerProps): ReactElement {
  const { select } = useSelection();
  const severity = severityOf(report);
  const count = report.issues.length;
  // Several issues can point at the same node (e.g. a blueprint changed and its code went out of sync in the
  // same drift report) — the quick-jump links should read as distinct targets, not the same id repeated.
  const distinctIds = [...new Set(report.issues.map((issue) => issue.nodeId))].slice(0, 3);

  return (
    <div className={styles.banner} data-severity={severity} role="status">
      {ICONS[severity]}
      <span className={styles.message}>
        {count === 0 ? (
          <>
            Sistema sincronizado — <span className={styles.count}>0</span> issues de drift
          </>
        ) : (
          <>
            <span className={styles.count}>{count}</span> issue{count === 1 ? '' : 's'} de drift ({severity})
          </>
        )}
      </span>
      {distinctIds.map((nodeId) => (
        <button key={nodeId} type="button" className={styles.link} onClick={() => select(nodeId)}>
          {nodeId}
        </button>
      ))}
    </div>
  );
}
