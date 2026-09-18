import type { DocKind } from '../domain/schema.js';
import type { DriftIssue } from '../sync/monitor.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';

/** Work orders are generated from a blueprint's task checklist (F-04), never authored by hand. */
export type DraftKind = Exclude<DocKind, 'WO'>;

export const DRAFT_KINDS: readonly DraftKind[] = ['MRD', 'PRD', 'FR', 'BC', 'SDD', 'ADR', 'ART', 'FB'];

export interface DraftContent {
  kind: DraftKind;
  title: string;
  body: string;
  fields?: Record<string, FieldValue>;
}

export type ValidationIssueCode = 'schema' | 'broken_link' | 'invalid_link_target' | 'draft_dependency' | 'lifecycle' | 'stale_base' | 'limit' | 'forbidden_field';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: ValidationIssueCode;
  field?: string;
  message: string;
}

export type DraftMode = 'create' | 'update';

export interface DraftView {
  draftId: string;
  projectId: string;
  mode: DraftMode;
  /** `${kind}-?` for a create draft (no id reservation until commit); the real id for an update draft. */
  targetId: string;
  kind: DraftKind;
  revision: number;
  expiresAt: string;
  targetPath: string | null;
  rendered: string;
  validation: { ok: boolean; issues: ValidationIssue[] };
}

export interface CommitResult {
  draftId: string;
  id: string;
  path: string;
  issues: DriftIssue[];
  hasBlockingIssues: boolean;
}

/** Thrown by `AuthoringService.commit` when validation finds blocking (error-severity) issues; nothing is written. */
export class DraftValidationError extends Error {
  constructor(
    readonly draftId: string,
    readonly issues: ValidationIssue[],
  ) {
    super(`draft ${draftId} failed validation: ${issues.map((i) => i.message).join('; ') || '(no details)'}`);
    this.name = 'DraftValidationError';
  }
}
