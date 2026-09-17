import type { DraftKind, ValidationIssue } from './types.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';
import { FIELD_KEY_PATTERN } from '../util/ids.js';

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
  'archived_at',
  'archived_by',
  'archive_reason',
]);

/** `status` may be drafted freely except into a terminal/lifecycle-managed value. */
export const FORBIDDEN_TERMINAL_STATUS: ReadonlySet<string> = new Set(['closed', 'done', 'out_of_sync']);

/** WO documents are never authored through drafts (they are generated from a blueprint's task checklist). */
export function assertDraftableKind(kind: string): asserts kind is DraftKind {
  if (kind === 'WO') throw new Error('work orders cannot be drafted (they are generated from a blueprint task list)');
}

/** Throws when a draft-supplied field key is not a plain snake_case identifier (WO-023 finding 6: defense against frontmatter-line injection through a crafted key). */
export function assertValidFieldKeys(fields: Record<string, unknown> | undefined): void {
  if (!fields) return;
  for (const key of Object.keys(fields)) {
    if (!FIELD_KEY_PATTERN.test(key)) throw new Error(`invalid field key ${JSON.stringify(key)}: field names must be snake_case (${FIELD_KEY_PATTERN})`);
  }
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

function sameFieldValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Defense in depth against frontmatter injection (WO-023 finding 6): re-checks forbidden fields on the ACTUAL
 * parsed frontmatter of the rendered document (post-render, post-parse) rather than the pre-render `fields`
 * object a key-injection attack could bypass. Compares against the base document's frontmatter for an update
 * (so carried-over values are never flagged) or against "absent" for a create.
 */
const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set(['id', 'type']);

export function forbiddenFieldInjectionIssues(rendered: Record<string, FieldValue>, base: Record<string, FieldValue> | undefined): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of FORBIDDEN_STATIC_FIELDS) {
    if (STRUCTURAL_FIELDS.has(key)) continue; // always freshly assigned by buildFrontmatterFields, never "changed" by the draft itself
    if (!sameFieldValue(rendered[key], base?.[key])) {
      issues.push({ severity: 'error', code: 'forbidden_field', field: key, message: `"${key}" cannot be changed from a draft; it is lifecycle-managed` });
    }
  }
  const renderedStatus = rendered.status;
  const baseStatus = base?.status;
  if (typeof renderedStatus === 'string' && FORBIDDEN_TERMINAL_STATUS.has(renderedStatus) && !sameFieldValue(renderedStatus, baseStatus)) {
    issues.push({ severity: 'error', code: 'forbidden_field', field: 'status', message: `status "${renderedStatus}" is lifecycle-managed and cannot be set from a draft` });
  }
  return issues;
}
