import { Globe, Grid2x2, LoaderCircle } from 'lucide-react';
import { useId, type ChangeEvent, type ReactElement, type RefObject } from 'react';
import { Button } from '../../components';
import { CENTURIONHQ_DOMAIN } from './lib';
import styles from './LoginPage.module.css';

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

function RedirectStatus({ label }: { readonly label: string }): ReactElement {
  return (
    <div role="status" className={styles.redirectStatus}>
      <LoaderCircle aria-hidden="true" size={16} className={styles.spinner} />
      {label}
    </div>
  );
}

const PROVIDER_LABEL: Record<SsoProvider, string> = {
  okta: 'Redirigiendo a Okta de Centurion HQ…',
  google: 'Redirigiendo a Google Workspace…',
  microsoft: 'Redirigiendo a Microsoft Entra ID…',
};

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
  const errorId = useId();

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>): void {
    onEmailChange(event.target.value);
  }

  return (
    <section className={styles.section}>
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
          onChange={handleEmailChange}
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
        {redirectingProvider === 'okta' ? <RedirectStatus label={PROVIDER_LABEL.okta} /> : null}
        {domainMessage ? <p className={styles.domainMessage}>{domainMessage}</p> : null}
        <p className={styles.helper}>
          Si tu dominio tiene SSO ({CENTURIONHQ_DOMAIN}), te llevamos al proveedor de tu organización.
        </p>
      </div>

      <div className={styles.providerGroup}>
        <Button type="button" variant="secondary" className={styles.fullWidth} onClick={() => onContinueProvider('google')}>
          <Globe aria-hidden="true" size={18} />
          Continuar con Google Workspace
        </Button>
        {redirectingProvider === 'google' ? <RedirectStatus label={PROVIDER_LABEL.google} /> : null}
        <Button type="button" variant="secondary" className={styles.fullWidth} onClick={() => onContinueProvider('microsoft')}>
          <Grid2x2 aria-hidden="true" size={18} />
          Continuar con Microsoft Entra ID
        </Button>
        {redirectingProvider === 'microsoft' ? <RedirectStatus label={PROVIDER_LABEL.microsoft} /> : null}
      </div>

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
