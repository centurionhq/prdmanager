/** Spanish label maps for the Documento screen (WO-287), local to this feature. */
import type { ProjectRole, VersionReason, WorkflowState } from '../../data';

// WO-288: the simulated "Ver como" role selector uses these labels as-is (not translated).
const ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  admin: 'Admin',
  editor: 'Editor',
  developer: 'Developer',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export function roleLabel(role: ProjectRole): string {
  return ROLE_LABELS[role];
}

const WORKFLOW_LABELS: Readonly<Record<WorkflowState, string>> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  published: 'Publicado',
  archived: 'Archivado',
};

export function workflowLabel(state: WorkflowState): string {
  return WORKFLOW_LABELS[state];
}

// WO-290 renders the version list with these; declared here so every WO shares one source.
const VERSION_REASON_LABELS: Readonly<Record<VersionReason, string>> = {
  manual: 'Manual',
  review_request: 'Pedido de revisión',
  published: 'Publicación',
  agent_accept: 'Propuesta aceptada',
  restore: 'Restauración',
  engine_write: 'Escritura del motor',
  import: 'Importación',
};

export function versionReasonLabel(reason: VersionReason): string {
  return VERSION_REASON_LABELS[reason];
}
