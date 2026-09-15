import type { ReactElement, RefObject } from 'react';
import styles from './LoginPage.module.css';
import { SsoEmailField } from './SsoEmailField';
import { SsoProviderButtons } from './SsoProviderButtons';

export type SsoProvider = 'okta' | 'google' | 'microsoft';

export interface SsoFormProps {
  readonly emailInputRef: RefObject<HTMLInputElement | null>;
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
  readonly validationError?: string;
  readonly domainMessage?: string;
  readonly redirectingProvider: SsoProvider | null;
  readonly onContinueSso: () => void;
  readonly onContinueProvider: (provider: 'google' | 'microsoft') => void;
  readonly onSwitchToPassword: () => void;
}

/** Default login mode: work email + SSO, per canvas/Login.dc.html. */
export function SsoForm({
  emailInputRef,
  email,
  onEmailChange,
  validationError,
  domainMessage,
  redirectingProvider,
  onContinueSso,
  onContinueProvider,
  onSwitchToPassword,
}: SsoFormProps): ReactElement {
  return (
    <section className={styles.section}>
      <SsoEmailField
        emailInputRef={emailInputRef}
        email={email}
        onEmailChange={onEmailChange}
        validationError={validationError}
        domainMessage={domainMessage}
        isRedirecting={redirectingProvider === 'okta'}
        onContinueSso={onContinueSso}
      />

      <SsoProviderButtons redirectingProvider={redirectingProvider} onContinueProvider={onContinueProvider} />

      <div className={styles.dividerRow}>
        <div className={styles.divider}>
          <span className={styles.rule} />
          <span className={styles.dividerLabel}>o con contraseña</span>
          <span className={styles.rule} />
        </div>
        <button type="button" className={styles.linkButton} onClick={onSwitchToPassword}>
          Usar email y contraseña
        </button>
      </div>
    </section>
  );
}
