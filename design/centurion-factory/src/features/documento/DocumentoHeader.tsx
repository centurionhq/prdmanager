/** DocumentoPage's PageHeader: breadcrumb, title, status/meta subtitle and the desktop actions. */
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Button, PageHeader, StatusBadge } from '../../components';
import type { ProjectDocument, ProjectRole, WorkflowState } from '../../data';
import styles from './DocumentoPage.module.css';
import { RoleSelect } from './RoleSelect';
import type { WorkflowTransition } from './useDocumentEditor';
import { WorkflowActions } from './WorkflowActions';

export interface DocumentoHeaderProps {
  readonly document: ProjectDocument;
  readonly workflowState: WorkflowState;
  readonly metaLine: string;
  readonly isMobile: boolean;
  readonly role: ProjectRole;
  readonly onRoleChange: (role: ProjectRole) => void;
  readonly errorCount: number;
  readonly onSave: () => void;
  readonly onTransition: (kind: WorkflowTransition) => void;
}

export function DocumentoHeader({
  document,
  workflowState,
  metaLine,
  isMobile,
  role,
  onRoleChange,
  errorCount,
  onSave,
  onTransition,
}: DocumentoHeaderProps): ReactElement {
  return (
    <PageHeader
      eyebrow={
        <nav aria-label="Ruta" className={styles.breadcrumb}>
          <Link to="/documentos">Documentos</Link>
          <span aria-hidden="true">/</span>
          <span className="id">{document.id}</span>
        </nav>
      }
      title={document.title}
      subtitle={
        <span className={styles.meta}>
          <StatusBadge kind="workflow" status={workflowState} />
          <span className={styles.metaText}>{metaLine}</span>
        </span>
      }
      actions={
        isMobile ? undefined : (
          <div className={styles.desktopActions}>
            <RoleSelect role={role} onChange={onRoleChange} />
            <Button type="button" variant="secondary" onClick={onSave}>
              Guardar
            </Button>
            <WorkflowActions workflowState={workflowState} role={role} errorCount={errorCount} onTransition={onTransition} />
          </div>
        )
      }
    />
  );
}
