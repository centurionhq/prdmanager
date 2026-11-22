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
 *
 * SDD-114 moved the explanation out of tooltips: one visible sentence (D1) says which total is the
 * reference and who counts the delta, and the `vista previa` badge lost its `title` because the sentence
 * already carries the meaning (D2). The branch label keeps its own `title` -- that is the raw `32/merge`
 * value, auditable data, not the explanation of the semantics.
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

const DELTA_CLASS = {
  worse: styles.deltaWorse,
  better: styles.deltaBetter,
  same: styles.deltaSame,
  unknown: styles.deltaUnknown,
} as const;

/**
 * SDD-114 D1: one visible sentence relates the two totals the screen shows. The official report of the
 * default branch is the reference of every delta, so it is also the state in force; a preview is the drift
 * of another commit and its total has nothing to do with the official one unless it says so. The branch
 * name comes from the project (`defaultBranch`) and the count from `official.issueCount` -- the same number
 * the delta already uses, never recomputed. With no official report there is no count to quote, so the
 * sentence says there is nothing to compare against instead of inventing a `0`.
 */
function legendText(defaultBranch: string, officialIssueCount: number | null): string {
  if (officialIssueCount === null) {
    return `Cada fila es el drift de un PR sobre su propio commit. Todavía no hay reporte oficial de ${defaultBranch}, así que no hay contra qué contar el delta.`;
  }
  const counted = officialIssueCount === 1 ? '1 issue' : `${officialIssueCount} issues`;
  return `Cada fila es el drift de un PR sobre su propio commit: su total no tiene por qué coincidir con el de ${defaultBranch}. El delta se cuenta contra el reporte oficial de ${defaultBranch} (${counted}), que es el estado vigente.`;
}

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
          <p className={styles.legend}>{legendText(defaultBranch, referenceIssueCount)}</p>
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
                      <span className={styles.badge}>vista previa</span>
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
