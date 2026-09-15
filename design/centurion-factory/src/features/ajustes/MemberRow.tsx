/** MembersTable's row for one active member: role select, last access, and remove action. */
import type { ChangeEvent, ReactElement } from 'react';
import type { Person, ProjectRole } from '../../data';
import { formatRelativeAccess } from './lib';
import styles from './MiembrosPage.module.css';
import { PROJECT_ROLES, ROLE_LABELS } from './permissions';

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

export interface MemberRowProps {
  readonly person: Person;
  readonly isYou: boolean;
  readonly onRoleChange: (person: Person, role: ProjectRole) => void;
  readonly onRequestRemove: (person: Person) => void;
}

export function MemberRow({ person, isYou, onRoleChange, onRequestRemove }: MemberRowProps): ReactElement {
  function handleRoleChange(event: ChangeEvent<HTMLSelectElement>): void {
    onRoleChange(person, event.target.value as ProjectRole);
  }

  return (
    <tr className={styles.row}>
      <td className={styles.cell}>
        <PersonCell person={person} isYou={isYou} />
      </td>
      <td data-label="Rol" className={styles.cell}>
        <select aria-label={`Rol de ${person.name}`} className={styles.roleSelect} value={person.projectRole} disabled={isYou} onChange={handleRoleChange}>
          {PROJECT_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </td>
      <td data-label="Acceso" className={`${styles.cell} num`}>
        {formatRelativeAccess(person.lastAccess)}
      </td>
      <td className={`${styles.cell} ${styles.actionsCell}`}>
        {isYou ? (
          <span className={styles.hintBadge}>No podés quitarte</span>
        ) : (
          <button type="button" className={styles.dangerLink} onClick={() => onRequestRemove(person)}>
            Quitar
          </button>
        )}
      </td>
    </tr>
  );
}
