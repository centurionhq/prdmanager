import { useId, type ReactElement } from 'react';
import styles from './ReadOnlyField.module.css';

export interface ReadOnlyFieldProps {
  readonly label: string;
  readonly value: string;
  /** Short reason it cannot change, drawn at the end of the box: "No se puede cambiar". */
  readonly note?: string;
  readonly hint?: string;
  /** The value is a literal identifier (an id, a handle, a path): the one place the mono face belongs. */
  readonly mono?: boolean;
}

/**
 * A value the person can read but not edit, in the same box a field would have (canvas `AjustesPerfil.dc.html`).
 * It is deliberately not a disabled `<input>`: a disabled control drops out of the tab order and, in several
 * browsers, out of selection, and the point of showing an id or an email is often that it can be copied. It is
 * named by its label through `role="group"`, so it is still announced as "Email" and not as loose text.
 */
export function ReadOnlyField({ label, value, note, hint, mono = false }: ReadOnlyFieldProps): ReactElement {
  const id = useId();
  return (
    <div className={styles.field} role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className={styles.label}>
        {label}
      </span>
      <div className={styles.box}>
        <span className={mono ? `id ${styles.value}` : styles.value}>{value}</span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
