import type { ReactElement } from 'react';
import { DRIFT_DEFAULT_BRANCH } from '../../data';
import { branchPreviews, officialReport } from './drift-data';
import { branchLabel, deltaLine, deltaTone, issueDelta, rankPreviews, type DeltaTone } from './previews';
import styles from './BranchPreviews.module.css';

const BADGE_TITLE = 'Reporte de vista previa: no es el reporte oficial de la rama por defecto.';

const DELTA_CLASS: Readonly<Record<DeltaTone, string>> = {
  worse: styles.deltaWorse ?? '',
  better: styles.deltaBetter ?? '',
  same: styles.deltaSame ?? '',
  unknown: styles.deltaUnknown ?? '',
};

/**
 * "Previews por rama", from canvas/Drift-Previews.dc.html (SDD-070 D2/D3/D5/D6).
 *
 * Rows are inert on purpose: the mock draws anatomy, copy and order, and the interactive control
 * (a row-sized `<button>` that opens the report detail) lives in `packages/app`
 * (`PreviewsByBranch.tsx`, WO-637). Hover, cursor and the focus ring are drawn here the same way the
 * canvas' other inert controls are, so the affordance survives the port.
 */
export function BranchPreviews(): ReactElement {
  const official = officialReport();
  const referenceIssueCount = official?.issueCount ?? null;
  const reports = rankPreviews(branchPreviews(), referenceIssueCount);

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>Previews por rama</h2>
      <div className={styles.head}>
        <span>Rama</span>
        <span className={styles.headIssues}>Issues</span>
        <span aria-hidden="true" />
      </div>
      <ul className={styles.list}>
        {reports.map((report) => {
          const branch = branchLabel(report.branch);
          const delta = issueDelta(report.issueCount, referenceIssueCount);
          return (
            <li key={report.id} className={styles.row}>
              <span className={styles.branchCell}>
                <span className={`id ${styles.label}`} title={branch.title}>
                  {branch.label}
                </span>
                <span className={styles.badge} title={BADGE_TITLE}>
                  vista previa
                </span>
              </span>
              <span className={styles.countCell}>
                <span className={`num ${styles.count} ${report.issueCount === 0 ? styles.countZero : styles.countSome}`}>
                  {report.issueCount}
                </span>
                <span className={`num ${styles.delta} ${DELTA_CLASS[deltaTone(delta)]}`}>
                  {deltaLine(delta, DRIFT_DEFAULT_BRANCH)}
                </span>
              </span>
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
