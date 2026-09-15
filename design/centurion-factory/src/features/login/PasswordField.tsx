/** PasswordForm's password input with a Mostrar/Ocultar toggle. */
import type { ChangeEvent, ReactElement } from 'react';
import styles from './LoginPage.module.css';

export interface PasswordFieldProps {
  readonly password: string;
  readonly onPasswordChange: (value: string) => void;
  readonly showPassword: boolean;
  readonly onToggleShowPassword: () => void;
  readonly hasError: boolean;
  readonly errorId: string;
}

export function PasswordField({ password, onPasswordChange, showPassword, onToggleShowPassword, hasError, errorId }: PasswordFieldProps): ReactElement {
  const fieldClass = [styles.input, hasError ? styles.inputError : null].filter(Boolean).join(' ');

  return (
    <div className={styles.fieldGroup}>
      <div className={styles.passwordLabelRow}>
        <label htmlFor="password-value" className={styles.label}>
          Contraseña
        </label>
      </div>
      <div className={fieldClass}>
        <input
          id="password-value"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          className={styles.passwordInput}
          value={password}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onPasswordChange(event.target.value)}
        />
        <button type="button" aria-pressed={showPassword} className={styles.toggleButton} onClick={onToggleShowPassword}>
          {showPassword ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </div>
  );
}
