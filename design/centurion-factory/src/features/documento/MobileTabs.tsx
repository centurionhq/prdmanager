/**
 * Mobile tab bar for the Documento screen: Documento | Agente | Comentarios | Versiones, shown
 * under 768px instead of the desktop's three columns.
 */
import { useState, type ReactElement } from 'react';
import { Tabs } from '../../components';
import type { AgentProposal, CommentThread, DocumentBlock, DocumentVersion, ProjectDocument } from '../../data';
import { AgentTab } from './AgentTab';
import { CommentsTab } from './CommentsTab';
import { EditorColumn } from './EditorColumn';
import type { EditorMode, ProposalOutcome } from './useDocumentEditor';
import { VersionsTab } from './VersionsTab';

export interface MobileTabsProps {
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
  readonly onBlocksChange: (next: readonly DocumentBlock[]) => void;
  readonly saveStatus: string;
  readonly editorMode: EditorMode;
  readonly onEditorModeChange: (mode: EditorMode) => void;
  readonly markdownDraft: string;
  readonly onMarkdownDraftChange: (draft: string) => void;
  readonly markdownLineBlockIds: readonly (string | undefined)[];
}

export function MobileTabs({
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
  onBlocksChange,
  saveStatus,
  editorMode,
  onEditorModeChange,
  markdownDraft,
  onMarkdownDraftChange,
  markdownLineBlockIds,
}: MobileTabsProps): ReactElement {
  const [activeId, setActiveId] = useState('documento');

  return (
    <Tabs
      ariaLabel="Secciones del documento"
      idPrefix="mobile"
      activeId={activeId}
      onChange={setActiveId}
      tabs={[
        {
          id: 'documento',
          label: 'Documento',
          panel: (
            <EditorColumn
              blocks={blocks}
              onBlocksChange={onBlocksChange}
              saveStatus={saveStatus}
              mode={editorMode}
              onModeChange={onEditorModeChange}
              markdownDraft={markdownDraft}
              onMarkdownDraftChange={onMarkdownDraftChange}
              markdownLineBlockIds={markdownLineBlockIds}
            />
          ),
        },
        {
          id: 'agente',
          label: 'Agente',
          panel: (
            <AgentTab documentId={document.id} blocks={blocks} proposals={proposals} onAccept={onAcceptProposal} onReject={onRejectProposal} />
          ),
        },
        { id: 'comentarios', label: 'Comentarios', panel: <CommentsTab threads={comments} onReply={onReply} onResolve={onResolveThread} /> },
        { id: 'versiones', label: 'Versiones', panel: <VersionsTab versions={versions} onRestore={onRestoreVersion} /> },
      ]}
    />
  );
}
