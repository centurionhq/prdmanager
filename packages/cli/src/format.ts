import type { DriftIssue, RefreshReport, SearchHit, SuccessMetrics, UnmeasuredReason } from '@prdm/core';

const ISSUE_MARKER: Record<DriftIssue['severity'], string> = { error: '✗', warning: '⚠' };

function groupByKind(issues: DriftIssue[]): Map<string, DriftIssue[]> {
  const groups = new Map<string, DriftIssue[]>();
  for (const issue of issues) groups.set(issue.kind, [...(groups.get(issue.kind) ?? []), issue]);
  return groups;
}

function formatIssue(issue: DriftIssue): string {
  const target = issue.target ? ` -> ${issue.target}` : '';
  return `  ${ISSUE_MARKER[issue.severity]} ${issue.nodeId}${target}: ${issue.message}`;
}

export function formatIssues(issues: DriftIssue[]): string {
  const lines: string[] = [];
  for (const [kind, group] of groupByKind(issues)) {
    lines.push(`${kind}:`);
    for (const issue of group) lines.push(formatIssue(issue));
  }
  return lines.join('\n');
}

export function formatScanErrors(errors: RefreshReport['errors']): string {
  return errors.map((err) => `  ✗ ${err.path}: ${err.error}`).join('\n');
}

export function formatRefreshReport(report: RefreshReport): string {
  const lines = [
    `documents: ${report.documents}`,
    `errors: ${report.errors.length}`,
    `issues: ${report.issues.length}`,
    `workOrderUpdates: ${report.workOrderUpdates.length}`,
    `baselineWritten: ${report.baselineWritten}`,
  ];
  if (report.errors.length > 0) lines.push(formatScanErrors(report.errors));
  if (report.issues.length > 0) lines.push(formatIssues(report.issues));
  return lines.join('\n');
}

export function summarizeRefresh(report: RefreshReport): string {
  return `refresh: ${report.documents} documents, ${report.errors.length} errors, ${report.issues.length} issues`;
}

function formatHours(value: number | null): string {
  return value === null ? 'n/a' : `${value}h`;
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${value}%`;
}

function formatAge(value: number | null): string {
  return value === null ? 'n/a' : `${value}d`;
}

function formatOrphanFeatures(orphans: SuccessMetrics['traceability']['orphanFeatures']): string[] {
  if (orphans.length === 0) return ['  orphan features: 0 (sin features huérfanas)'];
  return [`  orphan features: ${orphans.length}`, ...orphans.map((f) => `    ${f.id} <${f.kind}> ${f.title} (${f.status})`)];
}

const UNMEASURED_REASON_COPY: Record<UnmeasuredReason, string> = {
  missing_claim: 'sin fecha de reclamo',
  missing_completion: 'sin fecha de cierre',
  invalid_timestamp: 'fecha invalida',
  negative_duration: 'cierre anterior al reclamo',
};

function formatUnmeasured({ total, workOrders }: SuccessMetrics['agentHumanEfficiency']['unmeasured']): string[] {
  if (total === 0) return [];
  return (Object.keys(UNMEASURED_REASON_COPY) as UnmeasuredReason[])
    .map((reason) => ({ reason, ids: workOrders.filter((wo) => wo.reason === reason).map((wo) => wo.id) }))
    .filter(({ ids }) => ids.length > 0)
    .map(({ reason, ids }) => `  ordenes sin medicion: ${total} (${UNMEASURED_REASON_COPY[reason]}: ${ids.join(', ')})`);
}

export function formatMetrics(metrics: SuccessMetrics): string {
  const { agentHumanEfficiency: efficiency, systemIntegrity: integrity, traceability, pendingQueue: queue } = metrics;
  return [
    'Agent-Human Efficiency:',
    `  completed work orders: ${efficiency.completedWorkOrders} (measured: ${efficiency.measuredWorkOrders})`,
    `  avg resolution: ${formatHours(efficiency.avgResolutionHours)}`,
    `  median resolution: ${formatHours(efficiency.medianResolutionHours)}`,
    ...formatUnmeasured(efficiency.unmeasured),
    'Pending Queue:',
    `  total: ${queue.total} (unassigned: ${queue.unassigned})`,
    `  oldest: ${formatAge(queue.oldestDays)}`,
    `  over 7 days: ${queue.over7Days}`,
    'System Integrity:',
    `  governed: ${integrity.governedSynced}/${integrity.governedTotal} synced (${formatPercent(integrity.syncedPercent)})`,
    'Traceability:',
    `  features traced: ${traceability.featuresTraced}/${traceability.featuresTotal} (${formatPercent(traceability.featurePercent)})`,
    ...formatOrphanFeatures(traceability.orphanFeatures),
    `  commits traced: ${traceability.commitsTraced}/${traceability.commitsTotal} (${formatPercent(traceability.commitPercent)}), with refs: ${traceability.commitsWithRefs}`,
  ].join('\n');
}

export function formatSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return 'no results';
  return hits.map((hit) => `${hit.id} <${hit.label}> ${hit.title} (${hit.status}) score=${hit.score.toFixed(2)}`).join('\n');
}
