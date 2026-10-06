import { describe, expect, test } from 'vitest';
import type { RefreshReport } from '../../src/engine.js';
import type { DriftIssue, GovernedReason, IssueKind } from '../../src/sync/monitor.js';
import { DRIFT_REPORT_MAX_BYTES, summarizeRefreshReport } from '../../src/sync/report-summary.js';

const issue = (n: number, kind: IssueKind, severity: 'error' | 'warning'): DriftIssue => ({
  kind,
  severity,
  nodeId: `SDD-${n}`,
  target: `docs/design/some/long/path/for/node-${n}.md`,
  message: `Issue number ${n} of kind ${kind}: something drifted and needs a human to look at it before closing the work order.`,
});

const emptyReport = (): RefreshReport => ({
  documents: 0,
  errors: [],
  issues: [],
  governed: [],
  workOrderUpdates: [],
  baselineWritten: false,
  hasBlockingIssues: false,
});

const REASONS: GovernedReason[] = ['unchanged', 'new', 'resolved_by_commit', 'code_changed', 'missing'];

const makeReport = (issues: DriftIssue[], governedCount = 0): RefreshReport => ({
  ...emptyReport(),
  documents: 42,
  baselineWritten: true,
  hasBlockingIssues: issues.some((i) => i.severity === 'error'),
  issues,
  governed: Array.from({ length: governedCount }, (_, i) => {
    const reason = REASONS[i % REASONS.length]!;
    return {
      blueprintId: `SDD-${i % 90}`,
      key: `ref-${i}`,
      path: `packages/secret-governed/file-${i}.ts`,
      symbol: `symbol${i}`,
      status: reason === 'code_changed' || reason === 'missing' ? ('out_of_sync' as const) : ('synced' as const),
      reason,
      hash: 'a'.repeat(64),
    };
  }),
});

// 3 broken_link (error), 2 code_out_of_sync (error), 4 impacts_warning (warning), 1 deprecated_field (warning)
const mixedIssues = (): DriftIssue[] => [
  ...[1, 2, 3].map((n) => issue(n, 'broken_link', 'error')),
  ...[4, 5].map((n) => issue(n, 'code_out_of_sync', 'error')),
  ...[6, 7, 8, 9].map((n) => issue(n, 'impacts_warning', 'warning')),
  issue(10, 'deprecated_field', 'warning'),
];

describe('summarizeRefreshReport', () => {
  test('counts issues by kind and severity over the full report', () => {
    const s = summarizeRefreshReport(makeReport(mixedIssues()));

    expect(s.issues.total).toBe(10);
    expect(s.issues.byKind).toEqual({ broken_link: 3, code_out_of_sync: 2, impacts_warning: 4, deprecated_field: 1 });
    expect(s.issues.bySeverity).toEqual({ error: 5, warning: 5 });
    expect(s.documents).toBe(42);
    expect(s.baselineWritten).toBe(true);
    expect(s.hasBlockingIssues).toBe(true);
  });

  test('filters by kind only without changing the totals', () => {
    const s = summarizeRefreshReport(makeReport(mixedIssues()), { kind: 'impacts_warning' });

    expect(s.issues.matched).toBe(4);
    expect(s.issues.total).toBe(10);
    expect(s.issues.byKind.broken_link).toBe(3);
    expect(s.issues.bySeverity).toEqual({ error: 5, warning: 5 });
    expect(s.issues.items.every((i) => i.kind === 'impacts_warning')).toBe(true);
  });

  test('filters by severity only', () => {
    const s = summarizeRefreshReport(makeReport(mixedIssues()), { severity: 'error' });

    expect(s.issues.matched).toBe(5);
    expect(s.issues.items.map((i) => i.nodeId)).toEqual(['SDD-1', 'SDD-2', 'SDD-3', 'SDD-4', 'SDD-5']);
    expect(s.issues.total).toBe(10);
  });

  test('combines kind and severity filters', () => {
    const both = summarizeRefreshReport(makeReport(mixedIssues()), { kind: 'broken_link', severity: 'error' });
    const none = summarizeRefreshReport(makeReport(mixedIssues()), { kind: 'broken_link', severity: 'warning' });

    expect(both.issues.matched).toBe(3);
    expect(none.issues.matched).toBe(0);
    expect(none.issues.items).toEqual([]);
    expect(none.issues.total).toBe(10);
  });

  test('paginates without overlap and ends with a null nextOffset', () => {
    const report = makeReport(mixedIssues());
    const p1 = summarizeRefreshReport(report, { limit: 4, offset: 0 });
    const p2 = summarizeRefreshReport(report, { limit: 4, offset: 4 });
    const p3 = summarizeRefreshReport(report, { limit: 4, offset: 8 });

    const ids = [p1, p2, p3].map((p) => p.issues.items.map((i) => i.nodeId));
    expect(new Set(ids.flat()).size).toBe(10);
    expect(p1.issues.nextOffset).toBe(4);
    expect(p1.issues.truncated).toBe(true);
    expect(p2.issues.nextOffset).toBe(8);
    expect(p3.issues.items).toHaveLength(2);
    expect(p3.issues.nextOffset).toBeNull();
  });

  test('returns null nextOffset when the page ends exactly at matched', () => {
    const s = summarizeRefreshReport(makeReport(mixedIssues()), { limit: 5, offset: 5 });

    expect(s.issues.items).toHaveLength(5);
    expect(s.issues.nextOffset).toBeNull();
  });

  test('offset past the end yields empty items, null nextOffset and truncated', () => {
    const s = summarizeRefreshReport(makeReport(mixedIssues()), { offset: 100 });

    expect(s.issues.items).toEqual([]);
    expect(s.issues.nextOffset).toBeNull();
    expect(s.issues.truncated).toBe(true);
    expect(s.issues.offset).toBe(100);
  });

  test('clamps limit and offset and reports the clamped values', () => {
    const report = makeReport(mixedIssues());

    expect(summarizeRefreshReport(report, { limit: 999 }).issues.limit).toBe(50);
    expect(summarizeRefreshReport(report, { limit: 0 }).issues.limit).toBe(25);
    expect(summarizeRefreshReport(report, { limit: Number.NaN }).issues.limit).toBe(25);
    expect(summarizeRefreshReport(report, { limit: 2.5 }).issues.limit).toBe(25);
    expect(summarizeRefreshReport(report).issues.limit).toBe(25);
    expect(summarizeRefreshReport(report, { offset: -3 }).issues.offset).toBe(0);
    expect(summarizeRefreshReport(report, { offset: Number.NaN }).issues.offset).toBe(0);
  });

  test('summarizes an empty report as zeros', () => {
    const s = summarizeRefreshReport(emptyReport());

    expect(s.issues).toMatchObject({ total: 0, matched: 0, items: [], nextOffset: null, truncated: false, byKind: {} });
    expect(s.issues.bySeverity).toEqual({ error: 0, warning: 0 });
    expect(s.governed).toEqual({ total: 0, synced: 0, outOfSync: 0, byReason: {} });
    expect(s.errors).toEqual({ total: 0, items: [], truncated: false });
    expect(s.workOrderUpdates).toEqual({ total: 0, items: [] });
  });

  test('has no hasReport and never exposes the governed list', () => {
    const s = summarizeRefreshReport(makeReport(mixedIssues(), 20));

    expect(s).not.toHaveProperty('hasReport');
    expect(s.governed).not.toHaveProperty('items');
    expect(JSON.stringify(s)).not.toContain('secret-governed');
    expect(s.governed.total).toBe(20);
    expect(s.governed.synced).toBe(12);
    expect(s.governed.outOfSync).toBe(8);
    expect(s.governed.byReason).toEqual({ unchanged: 4, new: 4, resolved_by_commit: 4, code_changed: 4, missing: 4 });
  });

  test('passes through every scan error and work order update', () => {
    const report: RefreshReport = {
      ...emptyReport(),
      errors: [{ path: 'a.md', error: 'bad yaml' }],
      workOrderUpdates: [{ id: 'WO-1', sourcePath: 'wo.md', from: 'pending', to: 'done' }],
    };
    const s = summarizeRefreshReport(report);

    expect(s.errors).toEqual({ total: 1, items: report.errors, truncated: false });
    expect(s.workOrderUpdates).toEqual({ total: 1, items: report.workOrderUpdates });
  });

  test('stays within DRIFT_REPORT_MAX_BYTES for a real-size report at max limit', () => {
    const kinds: IssueKind[] = ['broken_link', 'code_out_of_sync', 'impacts_warning', 'awaiting_ci_report'];
    const issues = Array.from({ length: 1022 }, (_, i) => issue(i, kinds[i % kinds.length]!, i % 2 === 0 ? 'error' : 'warning'));
    const s = summarizeRefreshReport(makeReport(issues, 10_335), { limit: 50 });

    expect(s.issues.items).toHaveLength(50);
    expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThanOrEqual(DRIFT_REPORT_MAX_BYTES);
  });

  test('does not mutate the input report', () => {
    const report = makeReport(mixedIssues(), 10);
    const before = JSON.stringify(report);

    summarizeRefreshReport(report, { kind: 'broken_link', limit: 2, offset: 1 });

    expect(JSON.stringify(report)).toBe(before);
  });
});
