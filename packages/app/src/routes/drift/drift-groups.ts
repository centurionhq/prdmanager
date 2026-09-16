/**
 * Grouping, message tokenization and acknowledge-target helpers for the Drift screen (SDD-013,
 * WO-361). Kept free of React, same convention as the Centurion Factory design package's own
 * `features/drift/drift-issue-groups.ts` this ports from mock `DriftIssue`s to the real `DriftIssueDto`.
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

export interface IssueGroup {
  readonly kind: string;
  readonly label: string;
  readonly issues: readonly DriftIssueDto[];
}

function labelFor(kind: string): string {
  return GROUP_LABELS[kind] ?? kind;
}

/** Groups by kind, in `GROUP_ORDER` first then any other kind found, dropping empty groups. */
export function groupIssues(issues: readonly DriftIssueDto[]): readonly IssueGroup[] {
  const knownKinds = new Set(GROUP_ORDER);
  const extraKinds = Array.from(new Set(issues.map((issue) => issue.kind).filter((kind) => !knownKinds.has(kind))));
  return [...GROUP_ORDER, ...extraKinds]
    .map((kind) => ({ kind, label: labelFor(kind), issues: issues.filter((issue) => issue.kind === kind) }))
    .filter((group) => group.issues.length > 0);
}

export function issuesForFeature(featureId: string | null, issues: readonly DriftIssueDto[]): readonly DriftIssueDto[] {
  if (!featureId) return issues;
  return issues.filter((issue) => issue.featureIds.includes(featureId));
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
