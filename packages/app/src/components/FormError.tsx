import type { ReactElement } from 'react';
import styles from '../styles/forms.module.css';

/** Server responses always win over client-side validation (WO-116: "el servidor siempre gana") — this
 * is the single place every screen surfaces either kind of error, `role="alert"` so a screen reader
 * announces it without the caller needing to manage focus manually. */
export function FormError({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p className={styles.error} role="alert">
      {message}
    </p>
  );
}
