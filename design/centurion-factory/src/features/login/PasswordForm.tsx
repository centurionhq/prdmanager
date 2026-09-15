import type { ChangeEvent, ReactElement, RefObject } from 'react';
import { Button } from '../../components';
import styles from './LoginPage.module.css';

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
  function handleEmailChange(event: ChangeEvent<HTMLInputElement>): void {
    onEmailChange(event.target.value);
  }

  function handlePasswordChange(event: ChangeEvent<HTMLInputElement>): void {
    onPasswordChange(event.target.value);
  }

  const passwordFieldClass = [styles.input, hasError ? styles.inputError : null].filter(Boolean).join(' ');

  return (
    <section className={styles.section}>
      {hasError ? (
        <div role="alert" className={styles.errorBox}>
          <span className={styles.errorMark} aria-hidden="true" />
          <span>
            <span className={styles.errorLead}>Email o contraseña incorrectos.</span> Revisá los datos o pedí un nuevo
            acceso a tu admin.
          </span>
        </div>
      ) : null}

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
          onChange={handleEmailChange}
        />
      </div>

      <div className={styles.fieldGroup}>
        <div className={styles.passwordLabelRow}>
          <label htmlFor="password-value" className={styles.label}>
            Contraseña
          </label>
        </div>
        <div className={passwordFieldClass}>
          <input
            id="password-value"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className={styles.passwordInput}
            value={password}
            aria-invalid={hasError}
            onChange={handlePasswordChange}
          />
          <button type="button" aria-pressed={showPassword} className={styles.toggleButton} onClick={onToggleShowPassword}>
            {showPassword ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

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
