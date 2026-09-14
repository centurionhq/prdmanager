/**
 * `/reset-password` (SDD-006 §Dashboard shell, WO-116): the request step (email only) and the
 * completion step (new password), picked purely by whether `?token=` is present in the URL — the emailed
 * link lands here with that query param once better-auth's own `GET /api/auth/reset-password/:token`
 * redirect validates it (see `packages/server/src/auth/allowlist.ts`'s WO-116 addition).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import { completePasswordReset, requestPasswordReset } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useFocusOnChange } from '../hooks/use-focus-on-change.js';
import styles from '../styles/forms.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;

function RequestResetForm(): ReactElement {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const emailValid = EMAIL_PATTERN.test(email);
  useDocumentTitle(sent ? 'Revisá tu email' : 'Restablecer contraseña');
  // See Login.tsx's TotpStep for why focus (not a live region) is the fix here.
  const confirmationRef = useFocusOnChange<HTMLHeadingElement>(sent);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!emailValid) return;

    setSubmitting(true);
    try {
      // The dashboard's own `/reset-password` route: the emailed link redirects back here with
      // `?token=...` appended once it validates (never trust the client's origin for anything more than
      // this — better-auth's own originCheck middleware still enforces PRDM_TRUSTED_ORIGINS).
      await requestPasswordReset(email, `${window.location.origin}/reset-password`);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title} ref={confirmationRef} tabIndex={-1}>
            Revisá tu email
          </h1>
          <p className={styles.subtitle}>Si ese email existe en el sistema, vas a recibir un enlace para restablecer tu contraseña.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.title}>Restablecer contraseña</h1>
        <div className={styles.field}>
          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            data-touched={touched}
            aria-describedby={touched && !emailValid ? 'reset-email-hint' : undefined}
            aria-invalid={touched && !emailValid}
            onChange={(e) => setEmail(e.target.value)}
          />
          {touched && !emailValid && (
            <span id="reset-email-hint" className={styles.hint}>
              Ingresá un email válido.
            </span>
          )}
        </div>
        <FormError message={error} />
        <div className={styles.actions}>
          <Link to="/login" className={styles.link}>
            Volver a iniciar sesión
          </Link>
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            Enviar enlace
          </button>
        </div>
      </form>
    </div>
  );
}

function CompleteResetForm({ token }: { token: string }): ReactElement {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const passwordValid = password.length >= MIN_PASSWORD_LENGTH;
  const confirmValid = confirmPassword === password;
  useDocumentTitle(done ? 'Contraseña actualizada' : 'Elegí una nueva contraseña');
  const confirmationRef = useFocusOnChange<HTMLHeadingElement>(done);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!passwordValid || !confirmValid) return;

    setSubmitting(true);
    try {
      await completePasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title} ref={confirmationRef} tabIndex={-1}>
            Contraseña actualizada
          </h1>
          <p className={styles.subtitle}>Ya podés iniciar sesión con tu nueva contraseña.</p>
          <div className={styles.actions}>
            <Link to="/login" className={styles.primaryButton}>
              Iniciar sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.title}>Elegí una nueva contraseña</h1>
        <div className={styles.field}>
          <label htmlFor="new-password">Nueva contraseña</label>
          <input
            id="new-password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            data-touched={touched}
            aria-describedby={touched && !passwordValid ? 'new-password-hint' : undefined}
            aria-invalid={touched && !passwordValid}
            onChange={(e) => setPassword(e.target.value)}
          />
          {touched && !passwordValid && (
            <span id="new-password-hint" className={styles.hint}>
              Mínimo {MIN_PASSWORD_LENGTH} caracteres.
            </span>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor="confirm-password">Confirmar contraseña</label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            data-touched={touched}
            aria-describedby={touched && !confirmValid ? 'confirm-password-hint' : undefined}
            aria-invalid={touched && !confirmValid}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {touched && !confirmValid && (
            <span id="confirm-password-hint" className={styles.hint}>
              Las contraseñas no coinciden.
            </span>
          )}
        </div>
        <FormError message={error} />
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}

export function ResetPassword(): ReactElement {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  return token ? <CompleteResetForm token={token} /> : <RequestResetForm />;
}
