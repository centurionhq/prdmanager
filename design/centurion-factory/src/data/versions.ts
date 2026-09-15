/**
 * Document version history (WO-271). 3-6 versions per document, except SDD-011 which is
 * intentionally at version 7 to match "Versión 7 · autores Julia Paz y Ana Ríos" in
 * canvas/Documento.dc.html (documented deviation from the general 3-6 guideline).
 */
import type { DocumentVersion } from './types';

function v(
  documentId: string,
  versionNo: number,
  reason: DocumentVersion['reason'],
  createdBy: string,
  createdAt: string,
  contributors: readonly string[],
  label?: string,
): DocumentVersion {
  return { documentId, versionNo, reason, createdBy, createdAt, contributors, ...(label ? { label } : {}) };
}

export const VERSIONS: readonly DocumentVersion[] = [
  v('MRD-001', 1, 'manual', 'ana-rios', '2026-09-12T09:00:00.000Z', ['ana-rios']),
  v('MRD-001', 2, 'review_request', 'ana-rios', '2026-09-12T09:40:00.000Z', ['ana-rios']),
  v('MRD-001', 3, 'published', 'ana-rios', '2026-09-12T10:00:00.000Z', ['ana-rios'], 'Aprobado'),

  v('PRD-001', 1, 'manual', 'julia-paz', '2026-09-12T10:30:00.000Z', ['julia-paz']),
  v('PRD-001', 2, 'review_request', 'julia-paz', '2026-09-12T11:15:00.000Z', ['julia-paz', 'ana-rios']),
  v('PRD-001', 3, 'manual', 'julia-paz', '2026-09-12T11:50:00.000Z', ['julia-paz']),
  v('PRD-001', 4, 'published', 'ana-rios', '2026-09-12T12:00:00.000Z', ['julia-paz', 'ana-rios'], 'Aprobado'),

  v('PRD-002', 1, 'manual', 'ana-rios', '2026-09-13T14:00:00.000Z', ['ana-rios']),
  v('PRD-002', 2, 'published', 'ana-rios', '2026-09-13T15:00:00.000Z', ['ana-rios'], 'Aprobado'),
  v('PRD-002', 3, 'engine_write', 'agent:claude', '2026-09-13T15:32:02.636Z', ['agent:claude'], 'Cerrado'),

  v('PRD-003', 1, 'manual', 'martin-sosa', '2026-09-13T14:30:00.000Z', ['martin-sosa']),
  v('PRD-003', 2, 'published', 'martin-sosa', '2026-09-13T15:10:00.000Z', ['martin-sosa'], 'Aprobado'),
  v('PRD-003', 3, 'engine_write', 'agent:claude', '2026-09-13T15:32:00.179Z', ['agent:claude'], 'Cerrado'),

  v('PRD-004', 1, 'manual', 'ana-rios', '2026-09-13T18:00:00.000Z', ['ana-rios']),
  v('PRD-004', 2, 'review_request', 'ana-rios', '2026-09-13T19:00:00.000Z', ['ana-rios']),
  v('PRD-004', 3, 'published', 'ana-rios', '2026-09-13T19:40:00.000Z', ['ana-rios'], 'Aprobado'),
  v('PRD-004', 4, 'engine_write', 'agent:claude', '2026-09-13T20:12:34.221Z', ['agent:claude'], 'Cerrado'),

  v('PRD-005', 1, 'manual', 'ana-rios', '2026-09-13T16:00:00.000Z', ['ana-rios']),
  v('PRD-005', 2, 'review_request', 'ana-rios', '2026-09-13T18:00:00.000Z', ['ana-rios', 'julia-paz']),
  v('PRD-005', 3, 'manual', 'julia-paz', '2026-09-14T09:00:00.000Z', ['julia-paz']),
  v('PRD-005', 4, 'published', 'ana-rios', '2026-09-14T10:00:00.000Z', ['ana-rios', 'julia-paz'], 'Aprobado'),
  v('PRD-005', 5, 'engine_write', 'agent:claude', '2026-09-15T10:50:24.973Z', ['agent:claude'], 'Cerrado'),

  v('PRD-006', 1, 'manual', 'ana-rios', '2026-09-15T07:00:00.000Z', ['ana-rios']),
  v('PRD-006', 2, 'review_request', 'ana-rios', '2026-09-15T08:00:00.000Z', ['ana-rios']),
  v('PRD-006', 3, 'published', 'ana-rios', '2026-09-15T09:00:00.000Z', ['ana-rios'], 'Aprobado'),

  v('FR-001', 1, 'manual', 'martin-sosa', '2026-09-13T19:30:00.000Z', ['martin-sosa']),
  v('FR-001', 2, 'review_request', 'martin-sosa', '2026-09-13T20:15:00.000Z', ['martin-sosa']),
  v('FR-001', 3, 'published', 'martin-sosa', '2026-09-13T21:00:00.000Z', ['martin-sosa'], 'Aprobado'),

  v('FR-002', 1, 'manual', 'ana-rios', '2026-09-14T08:00:00.000Z', ['ana-rios']),
  v('FR-002', 2, 'agent_accept', 'martin-sosa', '2026-09-14T08:30:00.000Z', ['martin-sosa', 'agent:deepseek']),
  v('FR-002', 3, 'published', 'ana-rios', '2026-09-14T09:00:00.000Z', ['ana-rios'], 'Aprobado'),

  v('FR-003', 1, 'manual', 'lucas-vera', '2026-09-15T07:00:00.000Z', ['lucas-vera']),
  v('FR-003', 2, 'manual', 'lucas-vera', '2026-09-15T07:30:00.000Z', ['lucas-vera']),
  v('FR-003', 3, 'manual', 'lucas-vera', '2026-09-15T08:00:00.000Z', ['lucas-vera']),

  v('SDD-001', 1, 'manual', 'julia-paz', '2026-09-12T12:30:00.000Z', ['julia-paz']),
  v('SDD-001', 2, 'review_request', 'julia-paz', '2026-09-12T13:00:00.000Z', ['julia-paz', 'ana-rios']),
  v('SDD-001', 3, 'published', 'julia-paz', '2026-09-12T13:00:00.000Z', ['julia-paz'], 'Aprobado'),

  v('SDD-002', 1, 'manual', 'julia-paz', '2026-09-13T09:30:00.000Z', ['julia-paz']),
  v('SDD-002', 2, 'review_request', 'julia-paz', '2026-09-13T09:50:00.000Z', ['julia-paz']),
  v('SDD-002', 3, 'published', 'julia-paz', '2026-09-13T10:00:00.000Z', ['julia-paz'], 'Aprobado'),

  v('SDD-011', 1, 'manual', 'julia-paz', '2026-09-15T06:00:00.000Z', ['julia-paz']),
  v('SDD-011', 2, 'manual', 'ana-rios', '2026-09-15T06:40:00.000Z', ['ana-rios']),
  v('SDD-011', 3, 'agent_accept', 'ana-rios', '2026-09-15T07:10:00.000Z', ['ana-rios', 'agent:claude']),
  v('SDD-011', 4, 'review_request', 'julia-paz', '2026-09-15T07:40:00.000Z', ['julia-paz']),
  v('SDD-011', 5, 'manual', 'ana-rios', '2026-09-15T08:20:00.000Z', ['ana-rios']),
  v('SDD-011', 6, 'manual', 'julia-paz', '2026-09-15T09:10:00.000Z', ['julia-paz']),
  v('SDD-011', 7, 'manual', 'julia-paz', '2026-09-15T09:47:00.000Z', ['julia-paz', 'ana-rios']),

  v('SDD-012', 1, 'manual', 'martin-sosa', '2026-09-14T18:00:00.000Z', ['martin-sosa']),
  v('SDD-012', 2, 'manual', 'martin-sosa', '2026-09-15T09:00:00.000Z', ['martin-sosa']),
  v('SDD-012', 3, 'manual', 'martin-sosa', '2026-09-15T10:02:00.000Z', ['martin-sosa']),

  v('ADR-002', 1, 'manual', 'julia-paz', '2026-09-13T10:30:00.000Z', ['julia-paz']),
  v('ADR-002', 2, 'review_request', 'julia-paz', '2026-09-13T10:45:00.000Z', ['julia-paz']),
  v('ADR-002', 3, 'published', 'julia-paz', '2026-09-13T11:00:00.000Z', ['julia-paz'], 'Aprobado'),

  v('ADR-007', 1, 'manual', 'ana-rios', '2026-09-15T09:00:00.000Z', ['ana-rios']),
  v('ADR-007', 2, 'review_request', 'ana-rios', '2026-09-15T09:15:00.000Z', ['ana-rios']),
  v('ADR-007', 3, 'published', 'ana-rios', '2026-09-15T09:30:00.000Z', ['ana-rios'], 'Aprobado'),

  v('FB-006', 1, 'import', 'ana-rios', '2026-09-10T16:00:00.000Z', ['ana-rios']),
  v('FB-006', 2, 'manual', 'ana-rios', '2026-09-10T16:10:00.000Z', ['ana-rios']),
  v('FB-006', 3, 'manual', 'ana-rios', '2026-09-13T21:30:00.000Z', ['ana-rios'], 'Triado'),

  v('FB-007', 1, 'import', 'lucas-vera', '2026-09-12T09:00:00.000Z', ['lucas-vera']),
  v('FB-007', 2, 'manual', 'lucas-vera', '2026-09-12T09:05:00.000Z', ['lucas-vera']),
  v('FB-007', 3, 'manual', 'ana-rios', '2026-09-13T08:00:00.000Z', ['ana-rios']),

  v('FB-008', 1, 'import', 'diego-fernandez', '2026-09-14T10:00:00.000Z', ['diego-fernandez']),
  v('FB-008', 2, 'manual', 'diego-fernandez', '2026-09-14T10:05:00.000Z', ['diego-fernandez']),
  v('FB-008', 3, 'manual', 'ana-rios', '2026-09-14T11:00:00.000Z', ['ana-rios']),

  v('ART-004', 1, 'import', 'julia-paz', '2026-09-12T18:00:00.000Z', ['julia-paz']),
  v('ART-004', 2, 'manual', 'julia-paz', '2026-09-12T18:15:00.000Z', ['julia-paz']),
  v('ART-004', 3, 'manual', 'ana-rios', '2026-09-12T19:00:00.000Z', ['ana-rios']),
];

export function versionsForDocument(documentId: string): readonly DocumentVersion[] {
  return VERSIONS.filter((version) => version.documentId === documentId);
}

export function latestVersion(documentId: string): DocumentVersion | undefined {
  return [...versionsForDocument(documentId)].sort((a, b) => b.versionNo - a.versionNo).at(0);
}
