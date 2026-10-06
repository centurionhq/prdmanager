/**
 * `/login` (SDD-006 §Dashboard shell, WO-116; re-skinned to the approved canvas per SDD-013
 * §"Login, TOTP, reseteo, invitación" — `design/centurion-factory/canvas/Login.dc.html`) with the
 * minimal TOTP challenge step (WO-120: `/admin` is unusable without it — superadmins have TOTP enrolled
 * per SDD-006 §Autenticación/WO-102). Flow: `POST /api/auth/sign-in/email` either signs the caller
 * straight in, or (an account with 2FA enrolled) replies `{twoFactorRedirect: true}` alongside a pending
 * session cookie the browser already stored (`credentials: 'include'`) — this screen then swaps to a
 * one-time-code form that posts to `/api/auth/two-factor/verify-totp` using that same cookie.
 *
 * FB-008: no SSO button — the canvas's own SSO-first mode is out of scope here, so this screen renders
 * only its "isPassword" section, direct to email + password.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { createAccessRequest, signInWithPassword, verifyTotpCode } from '../api/client.js';
import { loginDestinationFromNext, type LoginDestination } from '../api/request.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useFocusOnChange } from '../hooks/use-focus-on-change.js';
import styles from '../styles/auth.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The server accepts `ACCESS_REQUEST_MESSAGE_MAX_LENGTH` (2000); the cap here is 1000 by product decision (P6).
const REQUEST_MESSAGE_MAX_LENGTH = 1000;
const REQUEST_NAME_MAX_LENGTH = 120;

function destinationCopy(destination: LoginDestination | null): { title: string; subtitle: string } {
  if (!destination) {
    return { title: 'Entrá a tu organización', subtitle: 'Entrá con tu cuenta para ver tus organizaciones.' };
  }
  const { orgSlug, projSlug } = destination;
  return {
    title: `Entrá a ${orgSlug}`,
    subtitle: projSlug
      ? `Vas a entrar al proyecto ${projSlug} de la organización ${orgSlug}.`
      : `Vas a entrar a la organización ${orgSlug}.`,
  };
}

type Step = { kind: 'credentials' } | { kind: 'totp' } | { kind: 'request' } | { kind: 'request-sent' };

const DOCUMENT_TITLES: Record<Step['kind'], string> = {
  credentials: 'Iniciar sesión',
  totp: 'Verificación en dos pasos',
  request: 'Pedir acceso',
  'request-sent': 'Pedido enviado',
};

export function Login(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const destination = loginDestinationFromNext(searchParams.get('next'));
  const copy = destinationCopy(destination);
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestEmail, setRequestEmail] = useState('');
  const [requestName, setRequestName] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [requestTouched, setRequestTouched] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

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

  async function handleRequestSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setRequestTouched(true);
    setRequestError(null);
    if (!destination || !EMAIL_PATTERN.test(requestEmail)) return;

    const name = requestName.trim();
    const message = requestMessage.trim();
    setRequestSubmitting(true);
    try {
      await createAccessRequest(destination.orgSlug, { email: requestEmail, ...(name ? { name } : {}), ...(message ? { message } : {}) });
      setStep({ kind: 'request-sent' });
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setRequestSubmitting(false);
    }
  }

  useDocumentTitle(DOCUMENT_TITLES[step.kind]);

  if (destination && step.kind === 'request') {
    return (
      <RequestStep
        orgSlug={destination.orgSlug}
        email={requestEmail}
        name={requestName}
        message={requestMessage}
        emailInvalid={requestTouched && !EMAIL_PATTERN.test(requestEmail)}
        error={requestError}
        submitting={requestSubmitting}
        onEmailChange={setRequestEmail}
        onNameChange={setRequestName}
        onMessageChange={setRequestMessage}
        onSubmit={handleRequestSubmit}
        onBack={() => setStep({ kind: 'credentials' })}
      />
    );
  }

  if (destination && step.kind === 'request-sent') {
    return <RequestSentStep orgSlug={destination.orgSlug} onBack={() => setStep({ kind: 'credentials' })} />;
  }

  if (step.kind === 'totp') {
    return <TotpStep code={code} onCodeChange={setCode} onSubmit={handleTotpSubmit} error={error} submitting={submitting} />;
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleCredentialsSubmit} noValidate>
        <div className={styles.brand}>Centurion Factory</div>
        <div className={styles.section}>
          <div className={styles.heading}>
            <h1 className={styles.title}>{copy.title}</h1>
            <p className={styles.subtitle}>{copy.subtitle}</p>
          </div>
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
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            Entrar
          </button>
          <div className={styles.actions}>
            <Link to="/reset-password" className={styles.link}>
              Olvidé mi contraseña
            </Link>
          </div>
          {destination ? (
            <div className={styles.accessBlock}>
              <div className={styles.accessLabel}>¿Todavía no tenés acceso?</div>
              <p className={styles.hint}>Pedíselo a los administradores de {destination.orgSlug}.</p>
              <button type="button" className={styles.secondaryButton} onClick={() => setStep({ kind: 'request' })}>
                Pedir acceso a {destination.orgSlug}
              </button>
            </div>
          ) : null}
        </div>
      </form>
      <footer className={styles.footer}>
        <span>El acceso es por invitación: si todavía no tenés cuenta, pedile a quien te compartió el enlace que te invite.</span>
        <span>Centurion Factory</span>
      </footer>
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
        <div className={styles.brand}>Centurion Factory</div>
        <div className={styles.section}>
          <div className={styles.heading}>
            <h1 className={styles.title} ref={headingRef} tabIndex={-1}>
              Verificación en dos pasos
            </h1>
            <p className={styles.subtitle}>Ingresá el código de tu app de autenticación.</p>
          </div>
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
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            Verificar
          </button>
        </div>
      </form>
    </div>
  );
}

interface RequestStepProps {
  orgSlug: string;
  email: string;
  name: string;
  message: string;
  emailInvalid: boolean;
  error: string | null;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
}

function RequestStep(props: RequestStepProps): ReactElement {
  const { orgSlug, email, name, message, emailInvalid, error, submitting } = props;
  const headingRef = useFocusOnChange<HTMLHeadingElement>('request');
  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={props.onSubmit} noValidate>
        <div className={styles.brand}>Centurion Factory</div>
        <div className={styles.section}>
          <button type="button" className={styles.linkButton} onClick={props.onBack}>
            Volver
          </button>
          <div className={styles.heading}>
            <h1 className={styles.title} ref={headingRef} tabIndex={-1}>
              Pedí acceso a {orgSlug}
            </h1>
            <p className={styles.subtitle}>Un administrador de la organización va a revisar tu pedido. No necesitás tener cuenta todavía.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor="login-request-email">Email</label>
            <input
              id="login-request-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              aria-describedby={emailInvalid ? 'login-request-email-hint' : undefined}
              aria-invalid={emailInvalid}
              onChange={(e) => props.onEmailChange(e.target.value)}
            />
            {emailInvalid && (
              <span id="login-request-email-hint" className={styles.hint}>
                Ingresá un email válido.
              </span>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="login-request-name">Nombre (opcional)</label>
            <input
              id="login-request-name"
              name="name"
              type="text"
              autoComplete="name"
              maxLength={REQUEST_NAME_MAX_LENGTH}
              value={name}
              onChange={(e) => props.onNameChange(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="login-request-message">Mensaje (opcional)</label>
            <textarea
              id="login-request-message"
              name="message"
              className={styles.textarea}
              maxLength={REQUEST_MESSAGE_MAX_LENGTH}
              aria-describedby="login-request-message-hint"
              value={message}
              onChange={(e) => props.onMessageChange(e.target.value)}
            />
            <span id="login-request-message-hint" className={styles.hint}>
              Contales quién sos y para qué necesitás entrar.
            </span>
            <span className={styles.counter}>
              {message.length}/{REQUEST_MESSAGE_MAX_LENGTH}
            </span>
          </div>
          <FormError message={error} />
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            Enviar pedido
          </button>
        </div>
      </form>
    </div>
  );
}

function RequestSentStep({ orgSlug, onBack }: { orgSlug: string; onBack: () => void }): ReactElement {
  const headingRef = useFocusOnChange<HTMLHeadingElement>('request-sent');
  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={(event) => event.preventDefault()} noValidate>
        <div className={styles.brand}>Centurion Factory</div>
        <div className={styles.section}>
          <h1 className={styles.title} ref={headingRef} tabIndex={-1}>
            Pedido enviado
          </h1>
          <div className={styles.statusOk} role="status">
            <span>
              <b>El pedido quedó registrado.</b> Un administrador de {orgSlug} lo ve en Ajustes → Miembros.
            </span>
          </div>
          <p className={styles.subtitle}>No hace falta que hagas nada más. Si ya tenés una invitación por email, podés usarla para crear tu cuenta.</p>
          <button type="button" className={styles.secondaryButton} onClick={onBack}>
            Volver a entrar
          </button>
        </div>
      </form>
    </div>
  );
}
