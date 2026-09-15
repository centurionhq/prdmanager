/**
 * Validation issues (WO-271): FR-003 has 2 blocking errors (still a draft with no blueprint).
 * A couple of other documents carry non-blocking warnings; the rest are clean.
 */
import type { ValidationIssue } from './types';

export const VALIDATION_ISSUES: readonly ValidationIssue[] = [
  {
    documentId: 'FR-003',
    severity: 'error',
    code: 'missing_section',
    field: 'body',
    message: 'Falta la sección Alcance, requerida para un FR en la estación Definición.',
  },
  {
    documentId: 'FR-003',
    severity: 'error',
    code: 'no_blueprint',
    message: 'No tiene ningún blueprint que la diseñe todavía: no puede avanzar a Diseño sin uno.',
  },
  {
    documentId: 'PRD-006',
    severity: 'warning',
    code: 'unmatched_impacts_path',
    field: 'impacts_paths',
    message: 'packages/app/src/router.tsx todavía no existe en el repo.',
  },
  {
    documentId: 'SDD-012',
    severity: 'warning',
    code: 'stale_proposal',
    message: 'Hay una propuesta de agente stale desde antes del último cambio de este blueprint.',
  },
];

export function validationIssuesForDocument(documentId: string): readonly ValidationIssue[] {
  return VALIDATION_ISSUES.filter((issue) => issue.documentId === documentId);
}
