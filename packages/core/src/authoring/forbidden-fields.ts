import type { DraftKind, ValidationIssue } from './types.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';

/** Identity, lifecycle-managed and provenance fields a draft may never set directly (SDD-002 "Ciclo de vida"). */
export const FORBIDDEN_STATIC_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'closed_at',
  'closed_by',
  'resolved_by',
  'blueprint_hashes',
  'assigned_to',
  'claimed_at',
  'completed_at',
  'source_task',
]);

/** `status` may be drafted freely except into a terminal/lifecycle-managed value. */
export const FORBIDDEN_TERMINAL_STATUS: ReadonlySet<string> = new Set(['closed', 'done', 'out_of_sync']);

/** WO documents are never authored through drafts (they are generated from a blueprint's task checklist). */
export function assertDraftableKind(kind: string): asserts kind is DraftKind {
  if (kind === 'WO') throw new Error('work orders cannot be drafted (they are generated from a blueprint task list)');
}

export function forbiddenFieldIssues(fields: Record<string, FieldValue> | undefined): ValidationIssue[] {
  if (!fields) return [];
  const issues: ValidationIssue[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_STATIC_FIELDS.has(key)) {
      issues.push({ severity: 'error', code: 'forbidden_field', field: key, message: `"${key}" cannot be set from a draft; it is lifecycle-managed` });
      continue;
    }
    if (key === 'status' && typeof value === 'string' && FORBIDDEN_TERMINAL_STATUS.has(value)) {
      issues.push({ severity: 'error', code: 'forbidden_field', field: 'status', message: `status "${value}" is lifecycle-managed and cannot be set from a draft` });
    }
  }
  return issues;
}
