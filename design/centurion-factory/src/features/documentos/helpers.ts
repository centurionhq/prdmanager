/**
 * Pure helpers for the Documentos list (WO-286): label maps, relative dates and validation
 * summaries. Kept free of React so they are trivial to unit test through the page tests.
 */
import type { DocumentKind, WorkflowState } from '../../data';
import { formatRelativeRolling } from '../../lib/format-date';

export type ListedDocumentKind = Exclude<DocumentKind, 'WO'>;

export const DOCUMENT_KINDS: readonly ListedDocumentKind[] = ['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'FB', 'ART'];

const KIND_LABELS: Readonly<Record<ListedDocumentKind, string>> = {
  MRD: 'Mercado',
  PRD: 'Producto',
  FR: 'Feature request',
  SDD: 'Blueprint',
  ADR: 'Decisión',
  FB: 'Feedback',
  ART: 'Artefacto',
};

export function kindLabel(kind: ListedDocumentKind): string {
  return KIND_LABELS[kind];
}

export const WORKFLOW_STATES: readonly WorkflowState[] = ['draft', 'in_review', 'published', 'archived'];

const WORKFLOW_LABELS: Readonly<Record<WorkflowState, string>> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  published: 'Publicado',
  archived: 'Archivado',
};

export function workflowLabel(state: WorkflowState): string {
  return WORKFLOW_LABELS[state];
}

/** "hace N min" / "hace N h" / "ayer" / a short date, matching the canvas footer style. */
export function formatUpdated(iso: string, now: Date = new Date()): string {
  return formatRelativeRolling(iso, { now });
}

export interface ValidationSummary {
  readonly errorCount: number;
  readonly label: string;
}

/** "Sin errores" or "N errores"; only blocking `severity: 'error'` issues count. */
export function summarizeValidation(errorCount: number): ValidationSummary {
  if (errorCount === 0) return { errorCount, label: 'Sin errores' };
  return { errorCount, label: errorCount === 1 ? '1 error' : `${errorCount} errores` };
}
