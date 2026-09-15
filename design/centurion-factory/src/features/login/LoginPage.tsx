import type { ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../components';
import styles from './LoginPage.module.css';
import { PasswordForm } from './PasswordForm';
import { SsoForm } from './SsoForm';
import { useLoginForm } from './useLoginForm';

/** /login, outside the app shell. See canvas/Login.dc.html and LoginMobile.dc.html (WO-302). */
export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const form = useLoginForm(() => navigate('/proyectos'));

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

        {form.mode === 'sso' ? (
          <SsoForm
            emailInputRef={form.ssoEmailRef}
            email={form.email}
            onEmailChange={form.setEmail}
            validationError={form.validationError}
            domainMessage={form.domainMessage}
            redirectingProvider={form.redirectingProvider}
            onContinueSso={form.handleContinueSso}
            onContinueProvider={form.handleContinueProvider}
            onSwitchToPassword={form.handleSwitchToPassword}
          />
        ) : (
          <PasswordForm
            emailInputRef={form.passwordEmailRef}
            email={form.email}
            onEmailChange={form.setEmail}
            password={form.password}
            onPasswordChange={form.setPassword}
            showPassword={form.showPassword}
            onToggleShowPassword={form.toggleShowPassword}
            hasError={form.passwordError}
            onSubmit={form.handleSubmitPassword}
            onForgotPassword={() => toast.show('Te mandamos un enlace para restablecerla')}
            onSwitchToSso={form.handleSwitchToSso}
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
