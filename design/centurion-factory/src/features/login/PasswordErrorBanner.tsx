/** PasswordForm's "Email o contraseña incorrectos" alert banner. */
import type { ReactElement } from 'react';
import styles from './LoginPage.module.css';

export interface PasswordErrorBannerProps {
  readonly errorId: string;
}

export function PasswordErrorBanner({ errorId }: PasswordErrorBannerProps): ReactElement {
  return (
    <div id={errorId} role="alert" className={styles.errorBox}>
      <span className={styles.errorMark} aria-hidden="true" />
      <span>
        <span className={styles.errorLead}>Email o contraseña incorrectos.</span> Revisá los datos o pedí un nuevo acceso a tu admin.
      </span>
    </div>
  );
}
