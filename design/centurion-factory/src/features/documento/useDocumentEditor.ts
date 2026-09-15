/**
 * Local, mutable state for the Documento screen. Seeded from the mock data and never mutating it.
 * WO-287 added the document/versions/save baseline; WO-288 adds the simulated role and the
 * workflow transitions; WO-289/WO-290 add agent proposals, comments and version restore.
 */
import { useMemo, useState } from 'react';
import {
  getBlueprint,
  getDocument,
  getPerson,
  versionsForDocument,
  type DocumentVersion,
  type ProjectDocument,
  type ProjectRole,
  type VersionReason,
  type WorkflowState,
} from '../../data';
import { formatRelative } from './format';

/** "Editás como Admin de proyecto" in the header: the simulated current session. */
export const CURRENT_USER_ID = 'ana-rios';
export const CURRENT_USER_NAME = 'Ana Ríos';

export type WorkflowTransition = 'request_review' | 'publish' | 'back_to_draft' | 'archive' | 'restore_to_draft';

interface TransitionConfig {
  readonly next: WorkflowState;
  readonly reason: VersionReason;
  readonly toast: string;
}

// VersionReason has no dedicated "archived" / "back to draft" value, so those two transitions
// fall back to `manual`; `restore_to_draft` maps onto the existing `restore` reason.
const TRANSITIONS: Readonly<Record<WorkflowTransition, TransitionConfig>> = {
  request_review: { next: 'in_review', reason: 'review_request', toast: 'Revisión pedida' },
  publish: { next: 'published', reason: 'published', toast: 'Documento publicado' },
  back_to_draft: { next: 'draft', reason: 'manual', toast: 'Vuelto a borrador' },
  archive: { next: 'archived', reason: 'manual', toast: 'Documento archivado' },
  restore_to_draft: { next: 'draft', reason: 'restore', toast: 'Restaurado como borrador' },
};

export interface UseDocumentEditorResult {
  readonly document: ProjectDocument | undefined;
  readonly workflowState: WorkflowState | undefined;
  readonly versions: readonly DocumentVersion[];
  readonly metaLine: string;
  readonly architectOf: string | undefined;
  readonly role: ProjectRole;
  readonly setRole: (role: ProjectRole) => void;
  readonly save: () => void;
  readonly transition: (kind: WorkflowTransition) => string;
}

function nextVersionNumber(versions: readonly DocumentVersion[]): number {
  return versions.reduce((max, version) => Math.max(max, version.versionNo), 0) + 1;
}

function metaLineFor(document: ProjectDocument, savedJustNow: boolean, now: Date): string {
  const author = savedJustNow ? CURRENT_USER_NAME : (getPerson(document.updatedBy)?.name ?? document.updatedBy);
  const when = savedJustNow ? 'ahora' : formatRelative(document.updatedAt, now);
  return `${savedJustNow ? 'Guardado' : 'Editado'} por ${author} ${when}`;
}

export function useDocumentEditor(id: string, now: Date = new Date()): UseDocumentEditorResult {
  const document = useMemo(() => getDocument(id), [id]);
  const architectOf = useMemo(() => getBlueprint(id)?.architects[0], [id]);
  const [versions, setVersions] = useState<readonly DocumentVersion[]>(() => [...versionsForDocument(id)]);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const [workflowState, setWorkflowState] = useState<WorkflowState | undefined>(() => document?.workflowState);
  const [role, setRole] = useState<ProjectRole>('admin');

  function addVersion(reason: VersionReason, label?: string): void {
    if (!document) return;
    const version: DocumentVersion = {
      documentId: id,
      versionNo: nextVersionNumber(versions),
      reason,
      createdBy: CURRENT_USER_ID,
      createdAt: new Date().toISOString(),
      contributors: [CURRENT_USER_ID],
      ...(label ? { label } : {}),
    };
    setVersions((current) => [...current, version]);
  }

  function save(): void {
    addVersion('manual');
    setSavedJustNow(true);
  }

  function transition(kind: WorkflowTransition): string {
    const config = TRANSITIONS[kind];
    setWorkflowState(config.next);
    addVersion(config.reason);
    return config.toast;
  }

  const metaLine = document ? metaLineFor(document, savedJustNow, now) : '';

  return { document, workflowState, versions, metaLine, architectOf, role, setRole, save, transition };
}
