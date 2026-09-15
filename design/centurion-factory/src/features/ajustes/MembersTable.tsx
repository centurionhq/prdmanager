import { Mail } from 'lucide-react';
import type { ChangeEvent, ReactElement } from 'react';
import { getPerson, type Invitation, type Person, type ProjectRole } from '../../data';
import { formatDate, formatRelativeAccess } from './lib';
import styles from './MiembrosPage.module.css';
import { PROJECT_ROLES, ROLE_LABELS } from './permissions';

export interface MembersTableProps {
  readonly people: readonly Person[];
  readonly invitations: readonly Invitation[];
  readonly currentPersonId: string;
  readonly onRoleChange: (person: Person, role: ProjectRole) => void;
  readonly onRequestRemove: (person: Person) => void;
  readonly onResendInvite: (invitation: Invitation) => void;
  readonly onRevokeInvite: (invitation: Invitation) => void;
}

function PersonCell({ person, isYou }: { readonly person: Person; readonly isYou: boolean }): ReactElement {
  return (
    <div className={styles.personCell}>
      <span className={styles.avatar} aria-hidden="true">
        {person.initials}
      </span>
      <div className={styles.personText}>
        <span className={styles.personNameRow}>
          {person.name}
          {isYou ? <span className={styles.badge}>Vos</span> : null}
        </span>
        <span className={styles.personEmail}>{person.email}</span>
      </div>
    </div>
  );
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
  function handleRoleChange(person: Person, event: ChangeEvent<HTMLSelectElement>): void {
    onRoleChange(person, event.target.value as ProjectRole);
  }

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
        {people.map((person) => {
          const isYou = person.id === currentPersonId;
          return (
            <tr key={person.id} className={styles.row}>
              <td className={styles.cell}>
                <PersonCell person={person} isYou={isYou} />
              </td>
              <td className={styles.cell}>
                <select
                  aria-label={`Rol de ${person.name}`}
                  className={styles.roleSelect}
                  value={person.projectRole}
                  disabled={isYou}
                  onChange={(event) => handleRoleChange(person, event)}
                >
                  {PROJECT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </td>
              <td className={`${styles.cell} num`}>{formatRelativeAccess(person.lastAccess)}</td>
              <td className={`${styles.cell} ${styles.actionsCell}`}>
                {isYou ? <span className={styles.hintBadge}>No podés quitarte</span> : null}
                <button
                  type="button"
                  className={styles.dangerLink}
                  disabled={isYou}
                  onClick={() => onRequestRemove(person)}
                >
                  Quitar
                </button>
              </td>
            </tr>
          );
        })}

        {invitations.map((invitation) => (
          <tr key={invitation.email} className={styles.row}>
            <td className={styles.cell}>
              <div className={styles.personCell}>
                <span className={styles.avatarPending} aria-hidden="true">
                  <Mail size={16} />
                </span>
                <div className={styles.personText}>
                  <span className={styles.personNameRow}>
                    {invitation.email}
                    <span className={styles.badge}>Invitación pendiente</span>
                  </span>
                  <span className={styles.personEmail}>
                    {`Invitado por ${getPerson(invitation.invitedBy)?.name ?? invitation.invitedBy}, vence el ${formatDate(invitation.expiresAt)}`}
                  </span>
                </div>
              </div>
            </td>
            <td className={styles.cell}>{ROLE_LABELS[invitation.role]}</td>
            <td className={styles.cell}>
              <span aria-hidden="true">—</span>
              <span className="visually-hidden">Sin acceso todavía</span>
            </td>
            <td className={`${styles.cell} ${styles.actionsCell}`}>
              <button type="button" className={styles.linkButton} onClick={() => onResendInvite(invitation)}>
                Reenviar
              </button>
              <button type="button" className={styles.dangerLink} onClick={() => onRevokeInvite(invitation)}>
                Revocar
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
