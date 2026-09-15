/**
 * The "Agente / Comentarios / Versiones / Validación" side panel (SDD-013 §"Documentos", WO-359,
 * `Documento.dc.html`): one bordered card with real tabs (WO-348's `Tabs`) around the four existing,
 * already-tested panels — never touches their own business logic, only where they're mounted.
 */
import { useState, type ReactElement } from 'react';
import type { PermissionSubject, ValidationIssueSummary } from '@prdm/contracts';
import { Tabs } from '../components/index.js';
import { AgentPanel } from '../components/AgentPanel.js';
import { CommentsPanel } from '../components/CommentsPanel.js';
import { VersionsPanel } from '../components/VersionsPanel.js';
import { ValidationPanel } from '../components/ValidationPanel.js';
import styles from './DocumentPanelTabs.module.css';

export interface DocumentPanelTabsProps {
  readonly subject: PermissionSubject;
  readonly lastValidation: ValidationIssueSummary[] | null;
  readonly canRequestReview: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  readonly busy: boolean;
  readonly onRequestReview: () => void;
  readonly onPublish: () => void;
  readonly onArchive: () => void;
}

export function DocumentPanelTabs({
  subject,
  lastValidation,
  canRequestReview,
  canPublish,
  canArchive,
  busy,
  onRequestReview,
  onPublish,
  onArchive,
}: DocumentPanelTabsProps): ReactElement {
  const [activeId, setActiveId] = useState('agente');

  return (
    <div className={styles.card}>
      <Tabs
        ariaLabel="Panel del documento"
        idPrefix="document-panel"
        activeId={activeId}
        onChange={setActiveId}
        tabs={[
          { id: 'agente', label: 'Agente', panel: <AgentPanel subject={subject} /> },
          { id: 'comentarios', label: 'Comentarios', panel: <CommentsPanel subject={subject} /> },
          { id: 'versiones', label: 'Versiones', panel: <VersionsPanel subject={subject} /> },
          {
            id: 'validacion',
            label: 'Validación',
            panel: (
              <ValidationPanel
                subject={subject}
                initialIssues={lastValidation}
                canRequestReview={canRequestReview}
                canPublish={canPublish}
                canArchive={canArchive}
                busy={busy}
                onRequestReview={onRequestReview}
                onPublish={onPublish}
                onArchive={onArchive}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
