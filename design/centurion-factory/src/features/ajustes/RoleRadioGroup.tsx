/** InviteModal's "Rol en prdmanager" radiogroup with roving arrow-key focus, plus a hint per role. */
import { useId, type KeyboardEvent, type ReactElement } from 'react';
import type { ProjectRole } from '../../data';
import styles from './MiembrosPage.module.css';
import { PROJECT_ROLES, ROLE_HINTS, ROLE_LABELS } from './permissions';

export interface RoleRadioGroupProps {
  readonly role: ProjectRole;
  readonly onChange: (role: ProjectRole) => void;
}

export function RoleRadioGroup({ role, onChange }: RoleRadioGroupProps): ReactElement {
  const roleLabelId = useId();

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const isNext = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const isPrev = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!isNext && !isPrev) return;
    event.preventDefault();

    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const currentIndex = radios.findIndex((radio) => radio === document.activeElement);
    const delta = isNext ? 1 : -1;
    const nextIndex = (currentIndex + delta + radios.length) % radios.length;
    const nextRole = PROJECT_ROLES[nextIndex];
    const nextRadio = radios[nextIndex];
    if (!nextRole || !nextRadio) return;
    onChange(nextRole);
    nextRadio.focus();
  }

  return (
    <div className={styles.fieldGroup}>
      <label id={roleLabelId} className={styles.label}>
        Rol en prdmanager
      </label>
      <div role="radiogroup" aria-labelledby={roleLabelId} className={styles.roleSegments} onKeyDown={handleKeyDown}>
        {PROJECT_ROLES.map((option) => {
          const selected = option === role;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className={[styles.roleSegment, selected ? styles.roleSegmentSelected : null].filter(Boolean).join(' ')}
              onClick={() => onChange(option)}
            >
              {ROLE_LABELS[option]}
            </button>
          );
        })}
      </div>
      <p className={styles.fieldNote}>{ROLE_HINTS[role]}</p>
    </div>
  );
}
