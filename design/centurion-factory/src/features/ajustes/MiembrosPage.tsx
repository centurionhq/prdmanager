import { useState, type ReactElement } from 'react';
import { Button, Modal, useToast } from '../../components';
import { INVITATIONS, PEOPLE, type Invitation, type Person, type ProjectRole } from '../../data';
import type { InviteInput } from './InviteModal';
import { InviteModal } from './InviteModal';
import { MembersTable } from './MembersTable';
import styles from './MiembrosPage.module.css';
import { ROLE_LABELS } from './permissions';
import { RoleMatrix } from './RoleMatrix';

const CURRENT_PERSON_ID = 'ana-rios';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface PendingRemoval {
  readonly message: string;
  readonly onConfirm: () => void;
}

/** /ajustes/miembros: the project members table plus the role permission matrix (WO-305). */
export function MiembrosPage(): ReactElement {
  const toast = useToast();
  const [people, setPeople] = useState<readonly Person[]>(() => [...PEOPLE]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>(() => [...INVITATIONS]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  function handleRoleChange(person: Person, role: ProjectRole): void {
    setPeople((current) => current.map((entry) => (entry.id === person.id ? { ...entry, projectRole: role } : entry)));
    toast.show(`Rol de ${person.name}: ${ROLE_LABELS[role]}`);
  }

  function handleRequestRemove(person: Person): void {
    setPendingRemoval({
      message: `¿Quitar a ${person.name} de prdmanager? Pierde el acceso al instante.`,
      onConfirm: () => {
        setPeople((current) => current.filter((entry) => entry.id !== person.id));
        toast.show(`${person.name} ya no tiene acceso`);
        setPendingRemoval(null);
      },
    });
  }

  function handleResendInvite(): void {
    toast.show('Invitación reenviada');
  }

  function handleRevokeInvite(invitation: Invitation): void {
    setInvitations((current) => current.filter((entry) => entry.email !== invitation.email));
    toast.show('Invitación revocada');
  }

  function handleInvite(input: InviteInput): void {
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + WEEK_MS);
    setInvitations((current) => [
      ...current,
      {
        email: input.email,
        role: input.role,
        invitedBy: CURRENT_PERSON_ID,
        sentAt: sentAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    ]);
    setInviteOpen(false);
    toast.show('Invitación enviada');
  }

  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionText}>
          <h2 className={styles.sectionTitle}>Miembros de prdmanager</h2>
          <p className={styles.sectionDescription}>
            Quién puede ver, editar, publicar y reconocer drift en este proyecto.
          </p>
        </div>
        <Button type="button" variant="primary" onClick={() => setInviteOpen(true)}>
          Invitar persona
        </Button>
      </div>

      <MembersTable
        people={people}
        invitations={invitations}
        currentPersonId={CURRENT_PERSON_ID}
        onRoleChange={handleRoleChange}
        onRequestRemove={handleRequestRemove}
        onResendInvite={handleResendInvite}
        onRevokeInvite={handleRevokeInvite}
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

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvite={handleInvite} />

      <Modal
        open={pendingRemoval !== null}
        title="Quitar persona"
        onClose={() => setPendingRemoval(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPendingRemoval(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={() => pendingRemoval?.onConfirm()}>
              Confirmar
            </Button>
          </>
        }
      >
        <p>{pendingRemoval?.message}</p>
      </Modal>
    </>
  );
}
