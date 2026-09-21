import type { ReactElement } from 'react';
import styles from './PersonCell.module.css';

export interface PersonCellProps {
  readonly name: string;
  readonly email: string;
  /** This row is the person looking at the screen: it says "Vos", so it is never a stranger's row. */
  readonly you?: boolean;
}

/** A person in a members table (canvas `AjustesMiembros.dc.html`): initials, name, email, and "Vos" if it is you. */
export function PersonCell({ name, email, you = false }: PersonCellProps): ReactElement {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <span className={styles.person}>
      <span className={styles.avatar} aria-hidden="true">
        {initials || email.charAt(0).toUpperCase()}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>
          {name}
          {you ? <span className={styles.you}>Vos</span> : null}
        </span>
        <span className={styles.email}>{email}</span>
      </span>
    </span>
  );
}
