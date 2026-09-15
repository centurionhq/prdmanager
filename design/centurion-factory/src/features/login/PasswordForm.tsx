import { useId, type ChangeEvent, type ReactElement, type RefObject } from 'react';
import { Button } from '../../components';
import styles from './LoginPage.module.css';
import { PasswordErrorBanner } from './PasswordErrorBanner';
import { PasswordField } from './PasswordField';

export interface PasswordFormProps {
  readonly emailInputRef: RefObject<HTMLInputElement | null>;
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
  readonly password: string;
  readonly onPasswordChange: (value: string) => void;
  readonly showPassword: boolean;
  readonly onToggleShowPassword: () => void;
  readonly hasError: boolean;
  readonly onSubmit: () => void;
  readonly onForgotPassword: () => void;
  readonly onSwitchToSso: () => void;
}

/** Password login mode, per canvas/Login.dc.html. */
export function PasswordForm({
  emailInputRef,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  showPassword,
  onToggleShowPassword,
  hasError,
  onSubmit,
  onForgotPassword,
  onSwitchToSso,
}: PasswordFormProps): ReactElement {
  const errorId = useId();

  return (
    <section className={styles.section}>
      {hasError ? <PasswordErrorBanner errorId={errorId} /> : null}

      <div className={styles.fieldGroup}>
        <label htmlFor="password-email" className={styles.label}>
          Email
        </label>
        <input
          id="password-email"
          ref={emailInputRef}
          type="email"
          autoComplete="email"
          className={styles.input}
          value={email}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onEmailChange(event.target.value)}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={hasError ? errorId : undefined}
        />
      </div>

      <PasswordField
        password={password}
        onPasswordChange={onPasswordChange}
        showPassword={showPassword}
        onToggleShowPassword={onToggleShowPassword}
        hasError={hasError}
        errorId={errorId}
      />

      <Button type="button" variant="primary" className={styles.submitButton} onClick={onSubmit}>
        Entrar
      </Button>

      <div className={styles.passwordFooterRow}>
        <button type="button" className={styles.linkButton} onClick={onForgotPassword}>
          Olvidé mi contraseña
        </button>
        <button type="button" className={styles.linkButton} onClick={onSwitchToSso}>
          Volver al acceso con SSO
        </button>
      </div>
    </section>
  );
}
