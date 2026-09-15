/**
 * `/login` (SDD-006 §Dashboard shell, WO-116) with the minimal TOTP challenge step (WO-120: `/admin`
 * is unusable without it — superadmins have TOTP enrolled per SDD-006 §Autenticación/WO-102). Flow:
 * `POST /api/auth/sign-in/email` either signs the caller straight in, or (an account with 2FA enrolled)
 * replies `{twoFactorRedirect: true}` alongside a pending session cookie the browser already stored
 * (`credentials: 'include'`) — this screen then swaps to a one-time-code form that posts to
 * `/api/auth/two-factor/verify-totp` using that same cookie.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { signInWithPassword, verifyTotpCode } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useFocusOnChange } from '../hooks/use-focus-on-change.js';
import styles from '../styles/forms.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = { kind: 'credentials' } | { kind: 'totp' };

export function Login(): ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_PATTERN.test(email);
  const credentialsValid = emailValid && password.length > 0;

  async function handleCredentialsSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!credentialsValid) return;

    setSubmitting(true);
    try {
      const result = await signInWithPassword(email, password);
      if (result.twoFactorRedirect) {
        setStep({ kind: 'totp' });
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTotpSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (code.trim().length === 0) return;

    setSubmitting(true);
    try {
      await verifyTotpCode(code.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  useDocumentTitle(step.kind === 'totp' ? 'Verificación en dos pasos' : 'Iniciar sesión');

  if (step.kind === 'totp') {
    return <TotpStep code={code} onCodeChange={setCode} onSubmit={handleTotpSubmit} error={error} submitting={submitting} />;
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleCredentialsSubmit} noValidate>
        <h1 className={styles.title}>Iniciar sesión</h1>
        <div className={styles.field}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            data-touched={touched}
            aria-describedby={touched && !emailValid ? 'login-email-hint' : undefined}
            aria-invalid={touched && !emailValid}
            onChange={(e) => setEmail(e.target.value)}
          />
          {touched && !emailValid && (
            <span id="login-email-hint" className={styles.hint}>
              Ingresá un email válido.
            </span>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor="login-password">Contraseña</label>
          <input
            id="login-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            data-touched={touched}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <div className={styles.actions}>
          <Link to="/reset-password" className={styles.link}>
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            Ingresar
          </button>
        </div>
      </form>
    </div>
  );
}

interface TotpStepProps {
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  error: string | null;
  submitting: boolean;
}

function TotpStep({ code, onCodeChange, onSubmit, error, submitting }: TotpStepProps): ReactElement {
  // Moves focus to this step's own heading so a screen-reader user is told the form changed instead of
  // silently landing in a code input with no context (Phase 3 UI/a11y review, HIGH finding).
  const headingRef = useFocusOnChange<HTMLHeadingElement>('totp');
  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title} ref={headingRef} tabIndex={-1}>
          Verificación en dos pasos
        </h1>
        <p className={styles.subtitle}>Ingresá el código de tu aplicación de autenticación.</p>
        <div className={styles.field}>
          <label htmlFor="totp-code">Código</label>
          <input
            id="totp-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
          />
        </div>
        <FormError message={error} />
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            Verificar
          </button>
        </div>
      </form>
    </div>
  );
}
