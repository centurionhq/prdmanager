/**
 * Mobile tab bar for the Documento screen (WO-287): Documento | Agente | Comentarios | Versiones,
 * shown under 768px instead of the desktop's three columns. WO-289 wires the Agente tab; WO-290
 * fills in comments and versions.
 */
import { useState, type ReactElement } from 'react';
import { commentsForDocument, type AgentProposal, type DocumentBlock, type ProjectDocument } from '../../data';
import { AgentTab } from './AgentTab';
import { EditorColumn } from './EditorColumn';
import { Tabs } from './Tabs';
import type { ProposalOutcome } from './useDocumentEditor';

export interface MobileTabsProps {
  readonly document: ProjectDocument;
  readonly blocks: readonly DocumentBlock[];
  readonly proposals: readonly AgentProposal[];
  readonly onAcceptProposal: (proposalId: string) => ProposalOutcome;
  readonly onRejectProposal: (proposalId: string) => void;
}

export function MobileTabs({ document, blocks, proposals, onAcceptProposal, onRejectProposal }: MobileTabsProps): ReactElement {
  const [activeId, setActiveId] = useState('documento');
  const openComments = commentsForDocument(document.id).filter((thread) => thread.status === 'open').length;

  return (
    <Tabs
      ariaLabel="Secciones del documento"
      idPrefix="mobile"
      activeId={activeId}
      onChange={setActiveId}
      tabs={[
        { id: 'documento', label: 'Documento', panel: <EditorColumn blocks={blocks} /> },
        {
          id: 'agente',
          label: 'Agente',
          panel: (
            <AgentTab documentId={document.id} blocks={blocks} proposals={proposals} onAccept={onAcceptProposal} onReject={onRejectProposal} />
          ),
        },
        {
          id: 'comentarios',
          label: 'Comentarios',
          panel: <p>{openComments === 0 ? 'Sin comentarios abiertos.' : `${openComments} hilos de comentarios abiertos.`}</p>,
        },
        { id: 'versiones', label: 'Versiones', panel: <p>El historial de versiones se muestra acá.</p> },
      ]}
    />
  );
}
