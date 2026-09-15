/** SsoForm's work-email field, Continuar button and Okta redirect status. */
import { LoaderCircle } from 'lucide-react';
import { useId, type ChangeEvent, type ReactElement, type RefObject } from 'react';
import { Button } from '../../components';
import styles from './LoginPage.module.css';
import { CENTURIONHQ_DOMAIN } from './lib';

export interface SsoEmailFieldProps {
  readonly emailInputRef: RefObject<HTMLInputElement | null>;
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
  readonly validationError?: string;
  readonly domainMessage?: string;
  readonly isRedirecting: boolean;
  readonly onContinueSso: () => void;
}

export function SsoEmailField({
  emailInputRef,
  email,
  onEmailChange,
  validationError,
  domainMessage,
  isRedirecting,
  onContinueSso,
}: SsoEmailFieldProps): ReactElement {
  const errorId = useId();

  return (
    <div className={styles.fieldGroup}>
      <label htmlFor="sso-email" className={styles.label}>
        Email de trabajo
      </label>
      <input
        id="sso-email"
        ref={emailInputRef}
        type="email"
        autoComplete="email"
        className={styles.input}
        value={email}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onEmailChange(event.target.value)}
        aria-invalid={validationError ? true : undefined}
        aria-describedby={validationError ? errorId : undefined}
      />
      {validationError ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          {validationError}
        </p>
      ) : null}
      <Button type="button" variant="primary" className={styles.fullWidth} onClick={onContinueSso}>
        Continuar con SSO
      </Button>
      {isRedirecting ? (
        <div role="status" className={styles.redirectStatus}>
          <LoaderCircle aria-hidden="true" size={16} className={styles.spinner} />
          Redirigiendo a Okta de Centurion HQ…
        </div>
      ) : null}
      {domainMessage ? <p className={styles.domainMessage}>{domainMessage}</p> : null}
      <p className={styles.helper}>Si tu dominio tiene SSO ({CENTURIONHQ_DOMAIN}), te llevamos al proveedor de tu organización.</p>
    </div>
  );
}
