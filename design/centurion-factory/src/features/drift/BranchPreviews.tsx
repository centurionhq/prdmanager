import type { ReactElement } from 'react';
import type { DriftReport } from '../../data';
import { branchPreviews } from './drift-data';
import { formatRelativeTime } from './drift-format';
import styles from './BranchPreviews.module.css';

function IssueCount({ report }: { readonly report: DriftReport }): ReactElement {
  if (report.awaitingCi) {
    return (
      <span className={styles.noData}>
        <span className="visually-hidden">Sin datos: </span>Sin datos
      </span>
    );
  }
  const toneClass = report.issueCount === 0 ? styles.issueCountZero : styles.issueCountSome;
  return <span className={`${styles.issueCount} ${toneClass} num`}>{report.issueCount}</span>;
}

/** "Previews por rama": non-baseline reports, from canvas/Drift.dc.html. */
export function BranchPreviews(): ReactElement {
  const reports = branchPreviews();

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>Previews por rama</h2>
      <div className={styles.head}>
        <span>Rama</span>
        <span className={styles.headIssues}>Issues</span>
      </div>
      <ul className={styles.list}>
        {reports.map((report) => (
          <li key={report.id} className={styles.row}>
            <div className={styles.branchInfo}>
              <span className="id">{report.branch}</span>
              {report.awaitingCi ? (
                <span className={styles.awaiting}>
                  <span className={styles.andonDot} aria-hidden="true" />
                  Esperando reporte de CI
                </span>
              ) : (
                <span className={styles.meta}>
                  <span className={styles.badge}>vista previa</span>
                  {formatRelativeTime(report.createdAt)}
                </span>
              )}
            </div>
            <IssueCount report={report} />
          </li>
        ))}
      </ul>
    </div>
  );
}
