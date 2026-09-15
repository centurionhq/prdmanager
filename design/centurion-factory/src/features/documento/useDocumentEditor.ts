/**
 * Local, mutable state for the Documento screen. Seeded from the mock data and never mutating it.
 * WO-287 added the document/versions/save baseline; WO-288 adds the simulated role and the
 * workflow transitions; WO-289/WO-290 add agent proposals, comments and version restore.
 */
import { useMemo, useState } from 'react';
import {
  commentsForDocument,
  getBlueprint,
  getDocument,
  getPerson,
  proposalsForDocument,
  versionsForDocument,
  type AgentProposal,
  type CommentThread,
  type DocumentBlock,
  type DocumentVersion,
  type ProjectDocument,
  type ProjectRole,
  type VersionReason,
  type WorkflowState,
} from '../../data';
import { formatRelative } from './format';
import { findMatchingBlock, stripLinePrefix } from './proposalEdits';

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

export type ProposalOutcome = { readonly toast: string; readonly stale?: boolean };

export interface UseDocumentEditorResult {
  readonly document: ProjectDocument | undefined;
  readonly workflowState: WorkflowState | undefined;
  readonly blocks: readonly DocumentBlock[];
  readonly versions: readonly DocumentVersion[];
  readonly proposals: readonly AgentProposal[];
  readonly metaLine: string;
  readonly architectOf: string | undefined;
  readonly role: ProjectRole;
  readonly setRole: (role: ProjectRole) => void;
  readonly save: () => void;
  readonly transition: (kind: WorkflowTransition) => string;
  readonly acceptProposal: (proposalId: string) => ProposalOutcome;
  readonly rejectProposal: (proposalId: string) => void;
  readonly comments: readonly CommentThread[];
  readonly addReply: (threadId: string, body: string) => void;
  readonly resolveThread: (threadId: string) => void;
  readonly restoreVersion: (versionNo: number) => string;
  readonly updateBlocks: (next: readonly DocumentBlock[]) => void;
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
  const [blocks, setBlocks] = useState<readonly DocumentBlock[]>(() => document?.blocks ?? []);
  const [proposals, setProposals] = useState<readonly AgentProposal[]>(() => [...proposalsForDocument(id)]);
  const [comments, setComments] = useState<readonly CommentThread[]>(() => [...commentsForDocument(id)]);

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

  function acceptProposal(proposalId: string): ProposalOutcome {
    const proposal = proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal || proposal.status !== 'pending') return { toast: 'Propuesta aceptada' };

    const edit = proposal.edits[0];
    const target = edit ? findMatchingBlock(blocks, edit.expectedText) : undefined;
    if (!edit || !target) {
      setProposals((current) => current.map((item) => (item.id === proposalId ? { ...item, status: 'stale' } : item)));
      return { toast: 'Esta propuesta quedó vieja', stale: true };
    }

    setBlocks((current) =>
      current.map((block) =>
        block.id === target.id ? { ...block, text: stripLinePrefix(edit.replacement), author: 'agent', acceptedBy: CURRENT_USER_NAME } : block,
      ),
    );
    setProposals((current) => current.map((item) => (item.id === proposalId ? { ...item, status: 'accepted', respondedBy: CURRENT_USER_ID } : item)));
    addVersion('agent_accept');
    return { toast: 'Propuesta aceptada' };
  }

  function rejectProposal(proposalId: string): void {
    setProposals((current) => current.map((item) => (item.id === proposalId ? { ...item, status: 'rejected', respondedBy: CURRENT_USER_ID } : item)));
  }

  function addReply(threadId: string, body: string): void {
    setComments((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? { ...thread, comments: [...thread.comments, { authorId: CURRENT_USER_ID, body, createdAt: new Date().toISOString() }] }
          : thread,
      ),
    );
  }

  function resolveThread(threadId: string): void {
    setComments((current) =>
      current.map((thread) => (thread.id === threadId ? { ...thread, status: 'resolved', resolvedBy: CURRENT_USER_ID } : thread)),
    );
  }

  function restoreVersion(versionNo: number): string {
    addVersion('restore', `Restaurada de la versión ${versionNo}`);
    return 'Versión restaurada';
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
    proposals,
    metaLine,
    architectOf,
    role,
    setRole,
    save,
    transition,
    acceptProposal,
    rejectProposal,
    comments,
    addReply,
    resolveThread,
    restoreVersion,
    updateBlocks,
  };
}
