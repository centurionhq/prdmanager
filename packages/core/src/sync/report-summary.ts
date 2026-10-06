/**
 * SDD-082 (FR-013, BC-025): a bounded, pure summary of a `RefreshReport`. The full report can weigh several MB
 * (the `governed` list is ~75 %), so callers get counts plus one filtered page of issues instead.
 *
 * D6: the summary has no `hasReport` field. `{ hasReport: false }` (no refresh has run yet) belongs to the
 * MCP edge (WO-676), not to this core helper, which always receives a real report.
 */
import type { RefreshReport } from '../engine.js';
import type { ScanError } from '../parser/scan.js';
import type { DriftIssue, GovernedReason, IssueKind, WorkOrderUpdate } from './monitor.js';

/** D4: hard byte ceiling (64 KiB) for a serialized summary; enforced at the MCP edge. */
export const DRIFT_REPORT_MAX_BYTES = 65_536;
/** D2 */
export const DEFAULT_ISSUE_PAGE_LIMIT = 25;
export const MAX_ISSUE_PAGE_LIMIT = 50;

export interface DriftReportSummaryOptions {
  kind?: IssueKind;
  severity?: 'error' | 'warning';
  /** Default 25; out-of-range values are clamped to [1, 50]. */
  limit?: number;
  /** Default 0; negative / NaN values become 0. */
  offset?: number;
}

export interface DriftReportSummary {
  documents: number;
  hasBlockingIssues: boolean;
  baselineWritten: boolean;
  /** `truncated` is always `false` here; it is the flag the MCP byte-cap helper may re-mark when it trims `items`. */
  errors: { total: number; items: ScanError[]; truncated: boolean };
  issues: {
    /** `total`, `byKind` and `bySeverity` always describe the full report, regardless of filters. */
    total: number;
    byKind: Partial<Record<IssueKind, number>>;
    bySeverity: Record<'error' | 'warning', number>;
    /** Size of the filtered set; `items` is one page of it. */
    matched: number;
    items: DriftIssue[];
    limit: number;
    offset: number;
    nextOffset: number | null;
    truncated: boolean;
  };
  governed: {
    total: number;
    synced: number;
    outOfSync: number;
    byReason: Partial<Record<GovernedReason, number>>;
  };
  workOrderUpdates: { total: number; items: WorkOrderUpdate[] };
}

function countBy<T, K extends string>(items: readonly T[], keyOf: (item: T) => K): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) return DEFAULT_ISSUE_PAGE_LIMIT;
  return Math.min(limit, MAX_ISSUE_PAGE_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

export function summarizeRefreshReport(report: RefreshReport, opts: DriftReportSummaryOptions = {}): DriftReportSummary {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);

  const filtered = report.issues.filter((i) => (opts.kind === undefined || i.kind === opts.kind) && (opts.severity === undefined || i.severity === opts.severity));
  const items = filtered.slice(offset, offset + limit);
  const bySeverity = countBy(report.issues, (i) => i.severity);
  const synced = report.governed.filter((g) => g.status === 'synced').length;

  return {
    documents: report.documents,
    hasBlockingIssues: report.hasBlockingIssues,
    baselineWritten: report.baselineWritten,
    errors: { total: report.errors.length, items: [...report.errors], truncated: false },
    issues: {
      total: report.issues.length,
      byKind: countBy(report.issues, (i) => i.kind),
      bySeverity: { error: bySeverity.error ?? 0, warning: bySeverity.warning ?? 0 },
      matched: filtered.length,
      items,
      limit,
      offset,
      nextOffset: offset + limit < filtered.length ? offset + limit : null,
      truncated: items.length < filtered.length,
    },
    governed: {
      total: report.governed.length,
      synced,
      outOfSync: report.governed.length - synced,
      byReason: countBy(report.governed, (g) => g.reason),
    },
    workOrderUpdates: { total: report.workOrderUpdates.length, items: [...report.workOrderUpdates] },
  };
}
