/**
 * Desktop side panel of the Documento screen: tabs Agente | Comentarios (n) | Versiones |
 * Validación. WO-287 laid out the tabs; WO-289 wired Agente; WO-290 wires the rest.
 */
import { useState, type ReactElement } from 'react';
import {
  validationIssuesForDocument,
  type AgentProposal,
  type CommentThread,
  type DocumentBlock,
  type DocumentVersion,
  type ProjectDocument,
} from '../../data';
import { AgentTab } from './AgentTab';
import { CommentsTab } from './CommentsTab';
import { Tabs } from './Tabs';
import type { ProposalOutcome } from './useDocumentEditor';
import { ValidationTab } from './ValidationTab';
import { VersionsTab } from './VersionsTab';

export interface SidePanelProps {
  readonly document: ProjectDocument;
  readonly blocks: readonly DocumentBlock[];
  readonly proposals: readonly AgentProposal[];
  readonly onAcceptProposal: (proposalId: string) => ProposalOutcome;
  readonly onRejectProposal: (proposalId: string) => void;
  readonly comments: readonly CommentThread[];
  readonly onReply: (threadId: string, body: string) => void;
  readonly onResolveThread: (threadId: string) => void;
  readonly versions: readonly DocumentVersion[];
  readonly onRestoreVersion: (versionNo: number) => string;
}

export function SidePanel({
  document,
  blocks,
  proposals,
  onAcceptProposal,
  onRejectProposal,
  comments,
  onReply,
  onResolveThread,
  versions,
  onRestoreVersion,
}: SidePanelProps): ReactElement {
  const [activeId, setActiveId] = useState('agente');
  const openComments = comments.filter((thread) => thread.status === 'open').length;
  const validationIssues = validationIssuesForDocument(document.id);

  return (
    <Tabs
      ariaLabel="Panel del documento"
      idPrefix="panel"
      activeId={activeId}
      onChange={setActiveId}
      tabs={[
        {
          id: 'agente',
          label: 'Agente',
          panel: (
            <AgentTab documentId={document.id} blocks={blocks} proposals={proposals} onAccept={onAcceptProposal} onReject={onRejectProposal} />
          ),
        },
        {
          id: 'comentarios',
          label: (
            <>
              Comentarios <span className="num">({openComments})</span>
            </>
          ),
          panel: <CommentsTab threads={comments} onReply={onReply} onResolve={onResolveThread} />,
        },
        { id: 'versiones', label: 'Versiones', panel: <VersionsTab versions={versions} onRestore={onRestoreVersion} /> },
        { id: 'validacion', label: 'Validación', panel: <ValidationTab issues={validationIssues} /> },
      ]}
    />
  );
}
