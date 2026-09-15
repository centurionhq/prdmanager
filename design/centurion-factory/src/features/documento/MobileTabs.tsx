/**
 * Mobile tab bar for the Documento screen (WO-287): Documento | Agente | Comentarios | Versiones,
 * shown under 768px instead of the desktop's three columns. Panel bodies are placeholders here;
 * WO-289/WO-290 fill in the real agent, comments and versions content.
 */
import { useState, type ReactElement } from 'react';
import { commentsForDocument, type DocumentBlock, type ProjectDocument } from '../../data';
import { EditorColumn } from './EditorColumn';
import { Tabs } from './Tabs';

export interface MobileTabsProps {
  readonly document: ProjectDocument;
  readonly blocks: readonly DocumentBlock[];
}

export function MobileTabs({ document, blocks }: MobileTabsProps): ReactElement {
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
        { id: 'agente', label: 'Agente', panel: <p>Sin propuestas del agente para este documento.</p> },
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
