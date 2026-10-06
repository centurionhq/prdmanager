/**
 * Grouping, message tokenization and acknowledge-target helpers for the Drift screen (SDD-013,
 * WO-361). Kept free of React, same convention as the Centurion Factory design package's own
 * `features/drift/drift-issue-groups.ts` this ports from mock `DriftIssue`s to the real `DriftIssueDto`.
 *
 * SDD-061/WO-615 adds the pure triage layer on top of that: two-level grouping (kind → blueprint),
 * filtering and pagination. Still no React import here — the screen wires state, this file decides.
 */
import type { DriftIssueDto } from '@prdm/contracts';

export const GROUP_LABELS: Readonly<Record<string, string>> = {
  code_out_of_sync: 'Código fuera de sincronía',
  work_order_out_of_sync: 'Órdenes fuera de sincronía',
  broken_link: 'Enlaces rotos',
  invalid_link_target: 'Enlaces a un destino inválido',
  status_write_failed: 'Escritura de estado fallida',
  lifecycle_violation: 'Ciclo de vida',
  feature_changed: 'Features que cambiaron',
  blueprint_changed: 'Blueprints que cambiaron',
  deprecated_field: 'Campos deprecados',
  impacts_warning: 'Avisos de impacts_paths',
  awaiting_ci_report: 'Esperando reporte de CI',
};

// The first two keep the exact relative order Drift.dc.html shows; the rest are interleaved by how
// closely they relate. Any `kind` not listed here still gets its own group via `groupIssues`'s fallback.
const GROUP_ORDER: readonly string[] = [
  'code_out_of_sync',
  'work_order_out_of_sync',
  'broken_link',
  'invalid_link_target',
  'status_write_failed',
  'lifecycle_violation',
  'feature_changed',
  'blueprint_changed',
  'deprecated_field',
  'impacts_warning',
  'awaiting_ci_report',
];

/** Label shown for issues the attribution step could not bind to a blueprint (SDD-061 R1). */
export const SUBGROUP_NO_BLUEPRINT_LABEL = 'Sin blueprint';

/** Second level of the grouping: the issues of one `kind` that share one `blueprintId`. */
export interface IssueSubgroup {
  readonly blueprintId: string | null;
  readonly label: string;
  readonly issues: readonly DriftIssueDto[];
}

export interface IssueGroup {
  readonly kind: string;
  readonly label: string;
  readonly subgroups: readonly IssueSubgroup[];
}

function labelFor(kind: string): string {
  return GROUP_LABELS[kind] ?? kind;
}

/** `blueprintId` or the explicit "Sin blueprint" label — an unattributed issue stays visible as such. */
export function subgroupLabel(blueprintId: string | null): string {
  return blueprintId ?? SUBGROUP_NO_BLUEPRINT_LABEL;
}

function subgroupsFor(kindIssues: readonly DriftIssueDto[]): readonly IssueSubgroup[] {
  const byBlueprint = new Map<string, DriftIssueDto[]>();
  const unattributed: DriftIssueDto[] = [];

  for (const issue of kindIssues) {
    if (issue.blueprintId === null) {
      unattributed.push(issue);
      continue;
    }
    const bucket = byBlueprint.get(issue.blueprintId);
    if (bucket) bucket.push(issue);
    else byBlueprint.set(issue.blueprintId, [issue]);
  }

  const attributed: IssueSubgroup[] = [...byBlueprint.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((blueprintId) => ({
      blueprintId,
      label: subgroupLabel(blueprintId),
      issues: byBlueprint.get(blueprintId) ?? [],
    }));

  // The unattributed subgroup is explicit and always last, so no issue is silently dropped.
  if (unattributed.length > 0) {
    attributed.push({ blueprintId: null, label: SUBGROUP_NO_BLUEPRINT_LABEL, issues: unattributed });
  }

  return attributed;
}

/**
 * Groups by kind, in `GROUP_ORDER` first then any other kind found, dropping empty groups; inside each
 * kind the issues are sub-grouped by `blueprintId` (ascending, "Sin blueprint" last).
 */
export function groupIssues(issues: readonly DriftIssueDto[]): readonly IssueGroup[] {
  const knownKinds = new Set(GROUP_ORDER);
  const extraKinds = Array.from(new Set(issues.map((issue) => issue.kind).filter((kind) => !knownKinds.has(kind))));
  return [...GROUP_ORDER, ...extraKinds]
    .map((kind) => ({ kind, label: labelFor(kind), issues: issues.filter((issue) => issue.kind === kind) }))
    .filter((group) => group.issues.length > 0)
    .map((group) => ({ kind: group.kind, label: group.label, subgroups: subgroupsFor(group.issues) }));
}

export function issuesForFeature(featureId: string | null, issues: readonly DriftIssueDto[]): readonly DriftIssueDto[] {
  if (!featureId) return issues;
  return issues.filter((issue) => issue.featureIds.includes(featureId));
}

/** The active filter set for the Drift list; `'all'` on a facet disables it (SDD-061 R2). */
export interface DriftFilters {
  readonly severity: 'all' | 'error' | 'warning';
  readonly kind: 'all' | string;
  readonly blueprintId: 'all' | string;
  readonly query: string;
}

export const EMPTY_FILTERS: DriftFilters = { severity: 'all', kind: 'all', blueprintId: 'all', query: '' };

function matchesQuery(issue: DriftIssueDto, query: string): boolean {
  const haystack = [issue.message, issue.nodeId, issue.target ?? '', issue.blueprintId ?? '', issue.featureIds.join(' ')]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

/** ANDs every active facet; a blank/whitespace `query` does not filter (SDD-061 R2). */
export function filterIssues(issues: readonly DriftIssueDto[], filters: DriftFilters): readonly DriftIssueDto[] {
  const query = filters.query.trim().toLowerCase();
  return issues.filter((issue) => {
    if (filters.severity !== 'all' && issue.severity !== filters.severity) return false;
    if (filters.kind !== 'all' && issue.kind !== filters.kind) return false;
    if (filters.blueprintId !== 'all' && issue.blueprintId !== filters.blueprintId) return false;
    if (query && !matchesQuery(issue, query)) return false;
    return true;
  });
}

/** Rows rendered per subgroup before the "mostrar más" control appears (SDD-061 R3). */
export const PAGE_SIZE = 50;

export interface PaginatedIssues {
  readonly visible: readonly DriftIssueDto[];
  readonly remaining: number;
}

/**
 * Cuts `issues` to how many rows the subgroup has already revealed, never below `pageSize`, and reports
 * how many rows are still hidden. Going past the end is a no-op, not an overflow.
 */
export function paginateIssues(
  issues: readonly DriftIssueDto[],
  visible: number,
  pageSize: number = PAGE_SIZE,
): PaginatedIssues {
  const shown = Math.max(visible, pageSize);
  return { visible: issues.slice(0, shown), remaining: Math.max(0, issues.length - shown) };
}

export interface MessageToken {
  readonly text: string;
  readonly mono: boolean;
}

// Matches literal ids (WO-310, SDD-012, FR-002…) and repo paths / branch names (contain a "/").
const MONO_TOKEN_PATTERN = /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|\b[A-Z]{2,4}-\d+\b/g;

/** Splits an issue message into plain/mono runs so ids and paths render in `.id` type. */
export function splitMessage(message: string): readonly MessageToken[] {
  const tokens: MessageToken[] = [];
  let cursor = 0;

  for (const match of message.matchAll(MONO_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ text: message.slice(cursor, index), mono: false });
    tokens.push({ text: match[0], mono: true });
    cursor = index + match[0].length;
  }
  if (cursor < message.length) tokens.push({ text: message.slice(cursor), mono: false });

  return tokens;
}

export const PROJECT_TARGET = 'all';

export interface AcknowledgeTarget {
  readonly value: string;
  readonly label: string;
}

/** Every blueprint with an open issue, plus "Todo el proyecto" last — the "Qué reconocer" select. */
export function acknowledgeableTargets(issues: readonly DriftIssueDto[]): readonly AcknowledgeTarget[] {
  const blueprintIds = Array.from(new Set(issues.map((issue) => issue.blueprintId).filter((id): id is string => Boolean(id))));
  const targets = blueprintIds.map((id) => ({ value: id, label: id }));
  return [...targets, { value: PROJECT_TARGET, label: 'Todo el proyecto' }];
}
