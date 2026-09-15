/**
 * "Ver como" role simulator (WO-288): lets QA and reviewers preview the workflow actions and
 * read-only messaging every project role sees, without a real auth system.
 */
import { useId, type ChangeEvent, type ReactElement } from 'react';
import type { ProjectRole } from '../../data';
import styles from './RoleSelect.module.css';
import { roleLabel } from './labels';

export interface RoleSelectProps {
  readonly role: ProjectRole;
  readonly onChange: (role: ProjectRole) => void;
}

const ROLES: readonly ProjectRole[] = ['admin', 'editor', 'developer', 'commenter', 'viewer'];

export function RoleSelect({ role, onChange }: RoleSelectProps): ReactElement {
  const selectId = useId();

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    onChange(event.target.value as ProjectRole);
  }

  return (
    <label className={styles.wrapper} htmlFor={selectId}>
      <span className={styles.label}>Ver como</span>
      <select id={selectId} className={styles.select} value={role} onChange={handleChange}>
        {ROLES.map((option) => (
          <option key={option} value={option}>
            {roleLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
