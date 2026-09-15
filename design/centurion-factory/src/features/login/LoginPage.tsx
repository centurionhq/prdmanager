import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../components';
import styles from './LoginPage.module.css';
import { CENTURIONHQ_DOMAIN, domainOf, isValidEmail, matchesDemoCredentials } from './lib';
import { PasswordForm } from './PasswordForm';
import { SsoForm, type SsoProvider } from './SsoForm';

type LoginMode = 'sso' | 'password';

const REDIRECT_DELAY_MS = 1200;

/** /login, outside the app shell. See canvas/Login.dc.html and LoginMobile.dc.html (WO-302). */
export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<LoginMode>('sso');
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string>();
  const [domainMessage, setDomainMessage] = useState<string>();
  const [redirectingProvider, setRedirectingProvider] = useState<SsoProvider | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(false);

  const ssoEmailRef = useRef<HTMLInputElement>(null);
  const passwordEmailRef = useRef<HTMLInputElement>(null);
  const isFirstRender = useRef(true);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const target = mode === 'sso' ? ssoEmailRef.current : passwordEmailRef.current;
    target?.focus();
  }, [mode]);

  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  function startRedirect(provider: SsoProvider): void {
    setRedirectingProvider(provider);
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
    redirectTimer.current = setTimeout(() => navigate('/proyectos'), REDIRECT_DELAY_MS);
  }

  function handleContinueSso(): void {
    setDomainMessage(undefined);
    if (!isValidEmail(email)) {
      setValidationError('Escribí tu email de trabajo.');
      ssoEmailRef.current?.focus();
      return;
    }
    setValidationError(undefined);
    const domain = domainOf(email);
    if (domain === CENTURIONHQ_DOMAIN) {
      startRedirect('okta');
      return;
    }
    setDomainMessage(
      `Tu organización no tiene SSO configurado para ${domain}. Entrá con email y contraseña o pedile acceso a tu admin.`,
    );
  }

  function handleContinueProvider(provider: 'google' | 'microsoft'): void {
    setValidationError(undefined);
    setDomainMessage(undefined);
    startRedirect(provider);
  }

  function handleSwitchToPassword(): void {
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
    setRedirectingProvider(null);
    setValidationError(undefined);
    setDomainMessage(undefined);
    setMode('password');
  }

  function handleSwitchToSso(): void {
    setPasswordError(false);
    setMode('sso');
  }

  function handleSubmitPassword(): void {
    if (matchesDemoCredentials(email, password)) {
      navigate('/proyectos');
      return;
    }
    setPasswordError(true);
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.headerBlock}>
          <div className={styles.wordmark}>Centurion Factory</div>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Entrá a tu organización</h1>
            <p className={styles.subtitle}>El acceso es solo por invitación.</p>
          </div>
        </div>

        {mode === 'sso' ? (
          <SsoForm
            emailInputRef={ssoEmailRef}
            email={email}
            onEmailChange={setEmail}
            validationError={validationError}
            domainMessage={domainMessage}
            redirectingProvider={redirectingProvider}
            onContinueSso={handleContinueSso}
            onContinueProvider={handleContinueProvider}
            onSwitchToPassword={handleSwitchToPassword}
          />
        ) : (
          <PasswordForm
            emailInputRef={passwordEmailRef}
            email={email}
            onEmailChange={setEmail}
            password={password}
            onPasswordChange={setPassword}
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword((value) => !value)}
            hasError={passwordError}
            onSubmit={handleSubmitPassword}
            onForgotPassword={() => toast.show('Te mandamos un enlace para restablecerla')}
            onSwitchToSso={handleSwitchToSso}
          />
        )}
      </main>

      <footer className={styles.footer}>
        <div>¿Te invitaron? Abrí el enlace del email para crear tu cuenta.</div>
        <div>Centurion Factory · prdmanager 0.2.0</div>
      </footer>
    </div>
  );
}
