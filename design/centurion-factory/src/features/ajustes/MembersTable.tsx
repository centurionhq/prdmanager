import type { ReactElement } from 'react';
import type { Invitation, Person, ProjectRole } from '../../data';
import { InvitationRow } from './InvitationRow';
import { MemberRow } from './MemberRow';
import styles from './MiembrosPage.module.css';

export interface MembersTableProps {
  readonly people: readonly Person[];
  readonly invitations: readonly Invitation[];
  readonly currentPersonId: string;
  readonly onRoleChange: (person: Person, role: ProjectRole) => void;
  readonly onRequestRemove: (person: Person) => void;
  readonly onResendInvite: (invitation: Invitation) => void;
  readonly onRevokeInvite: (invitation: Invitation) => void;
}

/** The members + pending-invitation table on the Miembros screen (WO-305). */
export function MembersTable({
  people,
  invitations,
  currentPersonId,
  onRoleChange,
  onRequestRemove,
  onResendInvite,
  onRevokeInvite,
}: MembersTableProps): ReactElement {
  return (
    <table className={styles.table}>
      <caption className="visually-hidden">Miembros de prdmanager</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.headerCell}>
            Persona
          </th>
          <th scope="col" className={styles.headerCell}>
            Rol
          </th>
          <th scope="col" className={styles.headerCell}>
            Acceso
          </th>
          <th scope="col" className={styles.headerCell}>
            <span className="visually-hidden">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {people.map((person) => (
          <MemberRow
            key={person.id}
            person={person}
            isYou={person.id === currentPersonId}
            onRoleChange={onRoleChange}
            onRequestRemove={onRequestRemove}
          />
        ))}

        {invitations.map((invitation) => (
          <InvitationRow key={invitation.email} invitation={invitation} onResend={onResendInvite} onRevoke={onRevokeInvite} />
        ))}
      </tbody>
    </table>
  );
}
