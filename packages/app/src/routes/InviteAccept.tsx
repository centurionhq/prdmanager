/**
 * `/invite/:id#s=<secret>` (SDD-006 §Autenticación, WO-116; re-skinned to the approved canvas per
 * SDD-013 §"Login, TOTP, reseteo, invitación" — `design/centurion-factory/canvas/InviteAccept.dc.html`):
 * the secret lives only in the URL fragment, which browsers never send to the server on navigation and
 * proxies/CDNs never log — read here purely client-side (`window.location.hash`) and sent to the server
 * only inside a POST body, never as part of any URL. A signed-in user whose session email matches the
 * invitation needs only the secret; a new user also supplies their name and a password (SDD-006:
 * "usuario existente ... solo secreto"; "usuario nuevo ... crea el usuario con el email de la
 * invitación"). The canvas's own inviter/org/role preview card needs a GET-invitation-by-id endpoint this
 * client doesn't have yet, so it's left out here — the accept POST body is unaffected either way.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router';
import { acceptInvitation, getSession } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useFocusOnChange } from '../hooks/use-focus-on-change.js';
import styles from '../styles/auth.module.css';

const MIN_PASSWORD_LENGTH = 12;

function Brand(): ReactElement {
  return <div className={styles.brand}>Centurion Factory</div>;
}

function readSecretFromHash(hash: string): string | null {
  const match = /(?:^|[#&])s=([^&]+)/.exec(hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function InviteAccept(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [secret, setSecret] = useState<string | null | undefined>(undefined);
  const [isSignedIn, setIsSignedIn] = useState<boolean | undefined>(undefined);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    setSecret(readSecretFromHash(window.location.hash));
    getSession()
      .then((session) => setIsSignedIn(Boolean(session)))
      .catch(() => setIsSignedIn(false));
  }, []);

  const nameValid = isSignedIn ? true : name.trim().length > 0;
  const passwordValid = isSignedIn ? true : password.length >= MIN_PASSWORD_LENGTH;
  const acceptLabel = isSignedIn ? 'Iniciar sesión y aceptar' : 'Crear cuenta y entrar';

  const title =
    secret === undefined || isSignedIn === undefined
      ? 'Cargando…'
      : !secret
        ? 'Enlace inválido'
        : accepted
          ? 'Invitación aceptada'
          : 'Creá tu cuenta';
  useDocumentTitle(title);
  // See Login.tsx's TotpStep for why focus (not a live region) is the fix here — three of this screen's
  // four states swap the entire form for a message with no other signal that anything changed.
  const headingRef = useFocusOnChange<HTMLHeadingElement>(title);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!id || !secret || !nameValid || !passwordValid) return;

    setSubmitting(true);
    try {
      await acceptInvitation(id, isSignedIn ? { secret } : { secret, name: name.trim(), password });
      setAccepted(true);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (secret === undefined || isSignedIn === undefined) {
    return (
      <div className={styles.page}>
        <p role="status">Cargando…</p>
      </div>
    );
  }

  if (!secret) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Brand />
          <div className={styles.statusCard} role="status">
            <h1 className={styles.statusHeading} ref={headingRef} tabIndex={-1}>
              Enlace inválido
            </h1>
            <p className={styles.statusBody}>Este enlace de invitación no es válido. Pedí que te reenvíen la invitación.</p>
          </div>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Brand />
          <div className={styles.statusCard} role="status">
            <h1 className={styles.statusHeading} ref={headingRef} tabIndex={-1}>
              Invitación aceptada
            </h1>
            <p className={styles.statusBody}>Te estamos redirigiendo…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <Brand />
        <div className={styles.section}>
          <div className={styles.heading}>
            <h1 className={styles.title}>Creá tu cuenta</h1>
            <p className={styles.subtitle}>
              {isSignedIn ? 'Ya iniciaste sesión: confirmá para unirte a la organización.' : 'Tu email ya viene fijado por la invitación.'}
            </p>
          </div>
          {!isSignedIn && (
            <>
              <div className={styles.field}>
                <label htmlFor="invite-name">Nombre</label>
                <input
                  id="invite-name"
                  name="name"
                  type="text"
                  required
                  value={name}
                  data-touched={touched}
                  aria-describedby={touched && !nameValid ? 'invite-name-hint' : undefined}
                  aria-invalid={touched && !nameValid}
                  onChange={(e) => setName(e.target.value)}
                />
                {touched && !nameValid && (
                  <span id="invite-name-hint" className={styles.hint}>
                    Ingresá tu nombre.
                  </span>
                )}
              </div>
              <div className={styles.field}>
                <label htmlFor="invite-password">Contraseña</label>
                <input
                  id="invite-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  data-touched={touched}
                  aria-describedby={touched && !passwordValid ? 'invite-password-hint' : undefined}
                  aria-invalid={touched && !passwordValid}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {touched && !passwordValid && (
                  <span id="invite-password-hint" className={styles.hint}>
                    Mínimo {MIN_PASSWORD_LENGTH} caracteres.
                  </span>
                )}
              </div>
            </>
          )}
          <FormError message={error} />
          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            {acceptLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
