/**
 * Grouping, message tokenization, per-issue actions and acknowledge targets for the Drift
 * issues list and the "Reconocer drift" modal (WO-294).
 */
import { BLUEPRINTS, DRIFT_ISSUES } from '../../data';
import type { Blueprint, DriftIssue, DriftKind } from '../../data';

export const GROUP_LABELS: Readonly<Record<DriftKind, string>> = {
  code_out_of_sync: 'Código fuera de sincronía',
  work_order_out_of_sync: 'Órdenes fuera de sincronía',
  lifecycle_violation: 'Ciclo de vida',
  impacts_warning: 'Avisos de impacts_paths',
  awaiting_ci_report: 'Esperando reporte de CI',
  broken_link: 'Enlaces rotos',
  invalid_link_target: 'Enlaces a un destino inválido',
  feature_changed: 'Features que cambiaron',
  blueprint_changed: 'Blueprints que cambiaron',
  status_write_failed: 'Escritura de estado fallida',
  deprecated_field: 'Campos deprecados',
};

// The first 5 keep the exact relative order canvas/Drift.dc.html shows; the rest (no canvas
// example) are interleaved by how closely they relate to those five.
const GROUP_ORDER: readonly DriftKind[] = [
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
  readonly kind: DriftKind;
  readonly label: string;
  readonly issues: readonly DriftIssue[];
}

/** Groups by kind, in `GROUP_ORDER`, dropping empty groups. */
export function groupIssues(issues: readonly DriftIssue[]): readonly IssueGroup[] {
  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    issues: issues.filter((issue) => issue.kind === kind),
  })).filter((group) => group.issues.length > 0);
}

export function issuesForFeature(featureId: string | null, issues: readonly DriftIssue[] = DRIFT_ISSUES): readonly DriftIssue[] {
  if (!featureId) return issues;
  return issues.filter((issue) => issue.featureId === featureId);
}

export interface IssueAction {
  readonly label: string;
  readonly to: string;
}

const WORK_ORDER_ID_PATTERN = /^WO-\d+$/;
const FEEDBACK_ID_PATTERN = /^FB-\d+$/;

/** WO ids open the order, FB ids go to triage, anything with a blueprint opens it — else none. */
export function actionForIssue(issue: DriftIssue): IssueAction | undefined {
  if (WORK_ORDER_ID_PATTERN.test(issue.nodeId)) return { label: 'Abrir orden', to: `/ordenes?orden=${issue.nodeId}` };
  if (FEEDBACK_ID_PATTERN.test(issue.nodeId)) return { label: 'Triar feedback', to: '/entrada' };
  if (issue.blueprintId) return { label: 'Ver blueprint', to: `/documentos/${issue.blueprintId}` };
  return undefined;
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

export const PROJECT_TARGET = '__project__';

export interface AcknowledgeTarget {
  readonly value: string;
  readonly label: string;
}

/** Every blueprint with an open issue, plus "Todo el proyecto" last. */
export function acknowledgeableTargets(
  issues: readonly DriftIssue[] = DRIFT_ISSUES,
  blueprints: readonly Blueprint[] = BLUEPRINTS,
): readonly AcknowledgeTarget[] {
  const blueprintIds = Array.from(new Set(issues.map((issue) => issue.blueprintId).filter((id): id is string => Boolean(id))));
  const targets = blueprintIds.map((id) => {
    const blueprint = blueprints.find((candidate) => candidate.id === id);
    return { value: id, label: blueprint ? `${id} · ${blueprint.title}` : id };
  });
  return [...targets, { value: PROJECT_TARGET, label: 'Todo el proyecto' }];
}

/** Issues a target's acknowledgement clears: one blueprint's, or every blueprint-tied issue for the project. */
export function issuesAcknowledgedBy(target: string, issues: readonly DriftIssue[]): readonly DriftIssue[] {
  if (target === PROJECT_TARGET) return issues.filter((issue) => issue.blueprintId);
  return issues.filter((issue) => issue.blueprintId === target);
}
