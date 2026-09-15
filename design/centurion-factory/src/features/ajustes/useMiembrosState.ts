/** Member/invitation list state and mutations for MiembrosPage (WO-305). */
import { useState } from 'react';
import { useToast } from '../../components';
import { INVITATIONS, PEOPLE, type Invitation, type Person, type ProjectRole } from '../../data';
import type { InviteInput } from './InviteModal';
import { ROLE_LABELS } from './permissions';

const CURRENT_PERSON_ID = 'ana-rios';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface PendingRemoval {
  readonly message: string;
  readonly onConfirm: () => void;
}

export interface UseMiembrosStateResult {
  readonly people: readonly Person[];
  readonly invitations: readonly Invitation[];
  readonly currentPersonId: string;
  readonly inviteOpen: boolean;
  readonly openInvite: () => void;
  readonly closeInvite: () => void;
  readonly pendingRemoval: PendingRemoval | null;
  readonly cancelRemoval: () => void;
  readonly handleRoleChange: (person: Person, role: ProjectRole) => void;
  readonly handleRequestRemove: (person: Person) => void;
  readonly handleResendInvite: () => void;
  readonly handleRevokeInvite: (invitation: Invitation) => void;
  readonly handleInvite: (input: InviteInput) => void;
}

export function useMiembrosState(): UseMiembrosStateResult {
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

  function handleRevokeInvite(invitation: Invitation): void {
    setInvitations((current) => current.filter((entry) => entry.email !== invitation.email));
    toast.show('Invitación revocada');
  }

  function handleInvite(input: InviteInput): void {
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + WEEK_MS);
    setInvitations((current) => [
      ...current,
      { email: input.email, role: input.role, invitedBy: CURRENT_PERSON_ID, sentAt: sentAt.toISOString(), expiresAt: expiresAt.toISOString() },
    ]);
    setInviteOpen(false);
    toast.show('Invitación enviada');
  }

  return {
    people,
    invitations,
    currentPersonId: CURRENT_PERSON_ID,
    inviteOpen,
    openInvite: () => setInviteOpen(true),
    closeInvite: () => setInviteOpen(false),
    pendingRemoval,
    cancelRemoval: () => setPendingRemoval(null),
    handleRoleChange,
    handleRequestRemove,
    handleResendInvite: () => toast.show('Invitación reenviada'),
    handleRevokeInvite,
    handleInvite,
  };
}
