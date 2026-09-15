/**
 * Desktop side panel of the Documento screen: tabs Agente | Comentarios (n) | Versiones |
 * Validación. WO-287 laid out the tabs; WO-289 wires the Agente tab; WO-290 wires the rest.
 */
import { useState, type ReactElement } from 'react';
import { commentsForDocument, validationIssuesForDocument, type AgentProposal, type DocumentBlock, type ProjectDocument } from '../../data';
import { AgentTab } from './AgentTab';
import { Tabs } from './Tabs';
import type { ProposalOutcome } from './useDocumentEditor';

export interface SidePanelProps {
  readonly document: ProjectDocument;
  readonly blocks: readonly DocumentBlock[];
  readonly proposals: readonly AgentProposal[];
  readonly onAcceptProposal: (proposalId: string) => ProposalOutcome;
  readonly onRejectProposal: (proposalId: string) => void;
}

export function SidePanel({ document, blocks, proposals, onAcceptProposal, onRejectProposal }: SidePanelProps): ReactElement {
  const [activeId, setActiveId] = useState('agente');
  const openComments = commentsForDocument(document.id).filter((thread) => thread.status === 'open').length;
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
          panel: <p>{openComments === 0 ? 'Sin comentarios abiertos.' : `${openComments} hilos de comentarios abiertos.`}</p>,
        },
        { id: 'versiones', label: 'Versiones', panel: <p>El historial de versiones se muestra acá.</p> },
        {
          id: 'validacion',
          label: 'Validación',
          panel: <p>{validationIssues.length === 0 ? 'Sin problemas de validación.' : `${validationIssues.length} problemas de validación.`}</p>,
        },
      ]}
    />
  );
}
