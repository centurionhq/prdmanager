import type { ReactElement } from 'react';
import { Button } from '../../components';
import { InviteModal } from './InviteModal';
import { MembersTable } from './MembersTable';
import styles from './MiembrosPage.module.css';
import { RemoveMemberModal } from './RemoveMemberModal';
import { RoleMatrix } from './RoleMatrix';
import { useMiembrosState } from './useMiembrosState';

/** /ajustes/miembros: the project members table plus the role permission matrix (WO-305). */
export function MiembrosPage(): ReactElement {
  const state = useMiembrosState();

  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionText}>
          <h2 className={styles.sectionTitle}>Miembros de prdmanager</h2>
          <p className={styles.sectionDescription}>
            Quién puede ver, editar, publicar y reconocer drift en este proyecto.
          </p>
        </div>
        <Button type="button" variant="primary" onClick={state.openInvite}>
          Invitar persona
        </Button>
      </div>

      <MembersTable
        people={state.people}
        invitations={state.invitations}
        currentPersonId={state.currentPersonId}
        onRoleChange={state.handleRoleChange}
        onRequestRemove={state.handleRequestRemove}
        onResendInvite={state.handleResendInvite}
        onRevokeInvite={state.handleRevokeInvite}
      />

      <div className={styles.matrixSection}>
        <div className={styles.matrixText}>
          <h3 className={styles.matrixTitle}>Qué puede hacer cada rol</h3>
          <p className={styles.matrixDescription}>
            Cada persona tiene un solo rol en este proyecto. Solo un admin puede cambiarlo.
          </p>
        </div>
        <RoleMatrix />
      </div>

      <InviteModal open={state.inviteOpen} onClose={state.closeInvite} onInvite={state.handleInvite} />
      <RemoveMemberModal state={state} />
    </>
  );
}
