/**
 * Desktop side panel of the Documento screen (WO-287): tabs Agente | Comentarios (n) | Versiones |
 * Validación. Panel bodies are placeholders here; WO-289 and WO-290 replace them with the real
 * agent proposal, comments, versions and validation content.
 */
import { useState, type ReactElement } from 'react';
import { commentsForDocument, validationIssuesForDocument, type ProjectDocument } from '../../data';
import { Tabs } from './Tabs';

export interface SidePanelProps {
  readonly document: ProjectDocument;
}

export function SidePanel({ document }: SidePanelProps): ReactElement {
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
        { id: 'agente', label: 'Agente', panel: <p>Sin propuestas del agente para este documento.</p> },
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
