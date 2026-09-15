/** Data selection for the Drift page (WO-293): the summary strip, branch previews and history. */
import { DRIFT_ISSUES, DRIFT_REPORTS, METRICS } from '../../data';
import type { DriftIssue, DriftReport } from '../../data';

export interface DriftSummaryCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly governedTotal: number;
  readonly syncedPercent: number;
}

/**
 * Every currently open issue counts here, not just the 6 the canvas illustrates for its baseline
 * report sample: the other 8 are older, still-unresolved issues (see the comment in data/drift.ts).
 */
export function summarize(issues: readonly DriftIssue[] = DRIFT_ISSUES, metrics = METRICS): DriftSummaryCounts {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    governedTotal: metrics.systemIntegrity.governedTotal,
    syncedPercent: metrics.systemIntegrity.syncedPercent,
  };
}

export function branchPreviews(reports: readonly DriftReport[] = DRIFT_REPORTS): readonly DriftReport[] {
  return reports.filter((report) => report.mode === 'preview');
}

export function reportHistory(reports: readonly DriftReport[] = DRIFT_REPORTS): readonly DriftReport[] {
  return [...reports.filter((report) => report.mode === 'baseline')].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
