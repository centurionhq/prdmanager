/**
 * "Previews por rama" panel (SDD-070 D4/D5, WO-637).
 *
 * Presentational only: it renders the preview reports it is handed, ranks them against the official
 * (default-branch) report and reports the click back through `onOpenReport`. It fetches nothing and
 * knows nothing about the API.
 *
 * The whole row is one native `<button>` (D4): keyboard focus, `Enter`/`Espacio` and the focus ring
 * come for free, and there is no nested control. The GitHub link of `branchDisplay` is deliberately
 * NOT rendered here -- an `<a>` inside a `<button>` is invalid HTML; that link belongs to the report
 * detail modal (SDD-070 D3/D4/D7, WO-638).
 */
import type { ReactElement } from 'react';
import type { DriftReportSummaryDto } from '@prdm/contracts';
import { branchDisplay, deltaTone, formatDelta, issueDelta, rankPreviews } from './previews.js';
import styles from './PreviewsByBranch.module.css';

export interface PreviewsByBranchProps {
  readonly previews: readonly DriftReportSummaryDto[];
  readonly official: DriftReportSummaryDto | null;
  readonly defaultBranch: string;
  readonly githubRepository: string | null;
  readonly onOpenReport: (reportId: string) => void;
}

const BADGE_TITLE = 'Reporte de vista previa: no es el reporte oficial de la rama por defecto.';

const DELTA_CLASS = {
  worse: styles.deltaWorse,
  better: styles.deltaBetter,
  same: styles.deltaSame,
  unknown: styles.deltaUnknown,
} as const;

export function PreviewsByBranch({
  previews,
  official,
  defaultBranch,
  githubRepository,
  onOpenReport,
}: PreviewsByBranchProps): ReactElement {
  const referenceIssueCount = official?.issueCount ?? null;
  const ranked = rankPreviews(previews, referenceIssueCount);

  return (
    <section>
      <h2 className={styles.sectionTitle}>Previews por rama</h2>
      {ranked.length === 0 ? (
        <p>No hay reportes de vista previa todavía.</p>
      ) : (
        <>
          <div className={styles.head}>
            <span>Rama</span>
            <span>Issues</span>
          </div>
          <ul className={styles.list}>
            {ranked.map((report) => {
              const display = branchDisplay(report.branch, githubRepository);
              const delta = issueDelta(report.issueCount, referenceIssueCount);
              const deltaText = delta === null ? '—' : formatDelta(delta);
              return (
                <li key={report.id}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => onOpenReport(report.id)}
                    aria-label={`Ver los ${report.issueCount} issues del reporte de ${display.label}`}
                  >
                    <span className={styles.branchCell}>
                      <span className={`id ${styles.label}`} title={display.title}>
                        {display.label}
                      </span>
                      <span className={styles.badge} title={BADGE_TITLE}>
                        vista previa
                      </span>
                    </span>
                    <span className={styles.countCell}>
                      <span className={report.issueCount === 0 ? styles.countZero : styles.countSome}>{report.issueCount}</span>
                      <span className={`${styles.delta} ${DELTA_CLASS[deltaTone(delta)]}`}>{`${deltaText} vs ${defaultBranch}`}</span>
                    </span>
                    <span className={styles.chevron} aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
