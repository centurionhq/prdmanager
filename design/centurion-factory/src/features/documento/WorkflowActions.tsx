/**
 * Workflow actions gated by the simulated role (WO-288): each transition updates the badge, adds
 * a version and toasts a confirmation. Viewers and commenters get a muted read-only line instead.
 */
import type { ReactElement } from 'react';
import { Button } from '../../components';
import type { ProjectRole, WorkflowState } from '../../data';
import styles from './WorkflowActions.module.css';
import type { WorkflowTransition } from './useDocumentEditor';

export interface WorkflowActionsProps {
  readonly workflowState: WorkflowState;
  readonly role: ProjectRole;
  readonly errorCount: number;
  readonly onTransition: (kind: WorkflowTransition) => void;
}

function publishBlockedMessage(errorCount: number): string {
  if (errorCount === 1) return 'Resolvé el error de validación para publicar.';
  return `Resolvé los ${errorCount} errores de validación para publicar.`;
}

export function WorkflowActions({ workflowState, role, errorCount, onTransition }: WorkflowActionsProps): ReactElement | null {
  if (role === 'viewer' || role === 'commenter') {
    return <span className={styles.readOnly}>Solo lectura para tu rol.</span>;
  }

  const canEdit = role === 'editor' || role === 'admin';
  const isAdmin = role === 'admin';

  if (workflowState === 'draft' && canEdit) {
    return (
      <Button type="button" variant="secondary" onClick={() => onTransition('request_review')}>
        Pedir revisión
      </Button>
    );
  }

  if (workflowState === 'in_review') {
    const blocked = errorCount > 0;
    return (
      <div className={styles.group}>
        {isAdmin ? (
          <div className={styles.publishGroup}>
            <Button type="button" variant="primary" disabled={blocked} onClick={() => onTransition('publish')}>
              Publicar
            </Button>
            {blocked ? <p className={styles.helper}>{publishBlockedMessage(errorCount)}</p> : null}
          </div>
        ) : null}
        {canEdit ? (
          <Button type="button" variant="secondary" onClick={() => onTransition('back_to_draft')}>
            Volver a borrador
          </Button>
        ) : null}
      </div>
    );
  }

  if (workflowState === 'published' && isAdmin) {
    return (
      <Button type="button" variant="secondary" onClick={() => onTransition('archive')}>
        Archivar
      </Button>
    );
  }

  if (workflowState === 'archived' && isAdmin) {
    return (
      <Button type="button" variant="secondary" onClick={() => onTransition('restore_to_draft')}>
        Restaurar como borrador
      </Button>
    );
  }

  return null;
}
