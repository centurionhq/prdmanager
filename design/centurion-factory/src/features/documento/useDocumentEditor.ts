/**
 * Local, mutable state for the Documento screen. Seeded from the mock data and never mutating it.
 * WO-287 added the document/versions/save baseline; WO-288 adds the simulated role and the
 * workflow transitions; WO-289/WO-290 add agent proposals, comments and version restore.
 *
 * Composes four focused hooks (WO-319): `useVersionHistory`, `useEditorModeSync`,
 * `useProposalActions` and `useCommentThreads`.
 */
import { useMemo, useState } from 'react';
import {
  getBlueprint,
  getDocument,
  getPerson,
  type DocumentBlock,
  type ProjectDocument,
  type ProjectRole,
  type VersionReason,
  type WorkflowState,
} from '../../data';
import { CURRENT_USER_ID, CURRENT_USER_NAME } from './documentEditorConstants';
import { formatRelative } from './format';
import { useCommentThreads, type UseCommentThreadsResult } from './useCommentThreads';
import { useEditorModeSync, type EditorMode, type UseEditorModeSyncResult } from './useEditorModeSync';
import { useProposalActions, type ProposalOutcome, type UseProposalActionsResult } from './useProposalActions';
import { useVersionHistory, type UseVersionHistoryResult } from './useVersionHistory';

export { CURRENT_USER_ID, CURRENT_USER_NAME };
export type { EditorMode, ProposalOutcome };

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

export type UseDocumentEditorResult = UseProposalActionsResult &
  UseCommentThreadsResult &
  Omit<UseVersionHistoryResult, 'addVersion'> &
  UseEditorModeSyncResult & {
    readonly document: ProjectDocument | undefined;
    readonly workflowState: WorkflowState | undefined;
    readonly blocks: readonly DocumentBlock[];
    readonly metaLine: string;
    readonly architectOf: string | undefined;
    readonly role: ProjectRole;
    readonly setRole: (role: ProjectRole) => void;
    readonly save: () => void;
    readonly transition: (kind: WorkflowTransition) => string;
    readonly updateBlocks: (next: readonly DocumentBlock[]) => void;
  };

function metaLineFor(document: ProjectDocument, savedJustNow: boolean, now: Date): string {
  const author = savedJustNow ? CURRENT_USER_NAME : (getPerson(document.updatedBy)?.name ?? document.updatedBy);
  const when = savedJustNow ? 'ahora' : formatRelative(document.updatedAt, now);
  return `${savedJustNow ? 'Guardado' : 'Editado'} por ${author} ${when}`;
}

export function useDocumentEditor(id: string, now: Date = new Date()): UseDocumentEditorResult {
  const document = useMemo(() => getDocument(id), [id]);
  const architectOf = useMemo(() => getBlueprint(id)?.architects[0], [id]);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const [workflowState, setWorkflowState] = useState<WorkflowState | undefined>(() => document?.workflowState);
  const [role, setRole] = useState<ProjectRole>('admin');
  const [blocks, setBlocks] = useState<readonly DocumentBlock[]>(() => document?.blocks ?? []);

  const { versions, addVersion, restoreVersion } = useVersionHistory(id, document);
  const editorModeSync = useEditorModeSync({ blocks, setBlocks });
  const proposalActions = useProposalActions({ id, effectiveBlocks: editorModeSync.effectiveBlocks, setBlocks, addVersion });
  const commentThreads = useCommentThreads(id);

  function save(): void {
    setBlocks(editorModeSync.effectiveBlocks());
    addVersion('manual');
    setSavedJustNow(true);
  }

  function transition(kind: WorkflowTransition): string {
    const config = TRANSITIONS[kind];
    setWorkflowState(config.next);
    addVersion(config.reason);
    return config.toast;
  }

  function updateBlocks(next: readonly DocumentBlock[]): void {
    setBlocks(next);
  }

  const metaLine = document ? metaLineFor(document, savedJustNow, now) : '';

  return {
    document,
    workflowState,
    blocks,
    versions,
    metaLine,
    architectOf,
    role,
    setRole,
    save,
    transition,
    restoreVersion,
    updateBlocks,
    ...editorModeSync,
    ...proposalActions,
    ...commentThreads,
  };
}
