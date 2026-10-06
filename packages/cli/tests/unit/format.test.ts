import { describe, expect, test } from 'vitest';
import type { DriftIssue, RefreshReport, SuccessMetrics } from '@prdm/core';
import { formatIssues, formatMetrics, formatRefreshReport, formatScanErrors, formatSearchHits, summarizeRefresh } from '../../src/format.js';

function report(overrides: Partial<RefreshReport> = {}): RefreshReport {
  return {
    documents: 3,
    errors: [],
    issues: [],
    governed: [],
    workOrderUpdates: [],
    baselineWritten: true,
    hasBlockingIssues: false,
    ...overrides,
  };
}

describe('formatScanErrors', () => {
  test('renders one marked line per scan error', () => {
    const text = formatScanErrors([{ path: 'docs/x.md', error: 'invalid YAML frontmatter' }]);
    expect(text).toBe('  ✗ docs/x.md: invalid YAML frontmatter');
  });
});

describe('formatIssues', () => {
  test('groups issues by kind and marks severity', () => {
    const issues: DriftIssue[] = [
      { kind: 'broken_link', severity: 'error', nodeId: 'FB-001', target: 'PRD-404', message: 'FB-001 links to missing PRD-404' },
      { kind: 'impacts_warning', severity: 'warning', nodeId: 'SDD-001', message: 'no files matched src/x/**' },
    ];
    const text = formatIssues(issues);
    expect(text).toContain('broken_link:');
    expect(text).toContain('✗ FB-001 -> PRD-404: FB-001 links to missing PRD-404');
    expect(text).toContain('impacts_warning:');
    expect(text).toContain('⚠ SDD-001: no files matched src/x/**');
  });
});

describe('formatRefreshReport', () => {
  test('includes scan errors and issues when present', () => {
    const text = formatRefreshReport(
      report({
        errors: [{ path: 'docs/x.md', error: 'boom' }],
        issues: [{ kind: 'blueprint_changed', severity: 'error', nodeId: 'SDD-001', message: 'SDD-001 changed' }],
      }),
    );
    expect(text).toContain('documents: 3');
    expect(text).toContain('errors: 1');
    expect(text).toContain('✗ docs/x.md: boom');
    expect(text).toContain('blueprint_changed:');
  });

  test('omits the error/issue sections when clean', () => {
    const text = formatRefreshReport(report());
    expect(text).not.toContain('✗');
    expect(text).toContain('issues: 0');
  });
});

describe('summarizeRefresh', () => {
  test('renders a single-line summary', () => {
    expect(summarizeRefresh(report({ documents: 5, errors: [{ path: 'a', error: 'b' }] }))).toBe('refresh: 5 documents, 1 errors, 0 issues');
  });
});

function metrics(overrides: Partial<SuccessMetrics> = {}): SuccessMetrics {
  return {
    agentHumanEfficiency: { completedWorkOrders: 0, measuredWorkOrders: 0, avgResolutionHours: null, medianResolutionHours: null, unmeasured: { total: 0, workOrders: [] } },
    systemIntegrity: { governedTotal: 0, governedSynced: 0, syncedPercent: null },
    traceability: { featuresTotal: 0, featuresTraced: 0, orphanFeatures: [], featurePercent: null, commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0, commitPercent: null },
    pendingQueue: { total: 0, unassigned: 0, oldestDays: null, over7Days: 0 },
    ...overrides,
  };
}

describe('formatMetrics', () => {
  const unmeasuredWo = (id: string, reason: 'missing_claim' | 'negative_duration') => ({ id, status: 'done', reason, claimedAt: null, completedAt: null });
  const efficiency = (unmeasured: { total: number; workOrders: ReturnType<typeof unmeasuredWo>[] }) => ({
    completedWorkOrders: unmeasured.total, measuredWorkOrders: 0, avgResolutionHours: null, medianResolutionHours: null, unmeasured,
  });

  test('lists unmeasured work orders with total, reason copy and ids', () => {
    const text = formatMetrics(metrics({ agentHumanEfficiency: efficiency({ total: 2, workOrders: [unmeasuredWo('WO-001', 'missing_claim'), unmeasuredWo('WO-002', 'missing_claim')] }) }));
    expect(text).toContain('ordenes sin medicion: 2 (sin fecha de reclamo: WO-001, WO-002)');
  });

  test('prints one line per reason present, in precedence order', () => {
    const text = formatMetrics(metrics({ agentHumanEfficiency: efficiency({ total: 2, workOrders: [unmeasuredWo('WO-001', 'negative_duration'), unmeasuredWo('WO-002', 'missing_claim')] }) }));
    expect(text).toContain('(sin fecha de reclamo: WO-002)\n  ordenes sin medicion: 2 (cierre anterior al reclamo: WO-001)');
  });

  test('prints nothing about unmeasured orders when total is 0', () => {
    expect(formatMetrics(metrics())).not.toContain('sin medicion');
  });

  test('renders n/a for null averages and percentages', () => {
    const text = formatMetrics(metrics());
    expect(text).toContain('avg resolution: n/a');
    expect(text).toContain('median resolution: n/a');
    expect(text).toContain('synced (n/a)');
  });

  test('renders concrete numbers when available', () => {
    const text = formatMetrics(
      metrics({
        agentHumanEfficiency: { completedWorkOrders: 2, measuredWorkOrders: 2, avgResolutionHours: 4, medianResolutionHours: 4, unmeasured: { total: 0, workOrders: [] } },
        systemIntegrity: { governedTotal: 2, governedSynced: 1, syncedPercent: 50 },
      }),
    );
    expect(text).toContain('avg resolution: 4h');
    expect(text).toContain('governed: 1/2 synced (50%)');
  });
});

describe('formatMetrics orphan features', () => {
  test('lists orphan features with id, kind, title and status', () => {
    const base = metrics();
    const text = formatMetrics(
      metrics({ traceability: { ...base.traceability, orphanFeatures: [{ id: 'BC-004', kind: 'BC', title: 'El Árbol...', status: 'approved' }] } }),
    );
    expect(text).toContain('orphan features: 1');
    expect(text).toContain('    BC-004 <BC> El Árbol... (approved)');
  });

  test('prints the honest line when there are none', () => {
    expect(formatMetrics(metrics())).toContain('orphan features: 0 (sin features huérfanas)');
  });
});

describe('formatMetrics pending queue', () => {
  test('renders the empty queue block', () => {
    const text = formatMetrics(metrics());
    expect(text).toContain('Pending Queue:');
    expect(text).toContain('total: 0 (unassigned: 0)');
    expect(text).toContain('oldest: n/a');
    expect(text).toContain('over 7 days: 0');
  });

  test('renders concrete queue numbers', () => {
    const text = formatMetrics(metrics({ pendingQueue: { total: 5, unassigned: 2, oldestDays: 17, over7Days: 3 } }));
    expect(text).toContain('total: 5 (unassigned: 2)');
    expect(text).toContain('oldest: 17d');
    expect(text).toContain('over 7 days: 3');
  });
});

describe('formatSearchHits', () => {
  test('renders "no results" for an empty list', () => {
    expect(formatSearchHits([])).toBe('no results');
  });

  test('renders each hit with its score', () => {
    const text = formatSearchHits([{ id: 'PRD-001', label: 'Feature', title: 'Graph Engine', status: 'approved', score: 1.5 }]);
    expect(text).toBe('PRD-001 <Feature> Graph Engine (approved) score=1.50');
  });
});
