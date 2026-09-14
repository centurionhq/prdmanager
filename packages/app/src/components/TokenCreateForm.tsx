/**
 * Shared "create a token" form for both personal tokens (`PersonalTokensSettings`) and per-project CI
 * tokens (`CiTokensSection`) — SDD-006 §Modelo de datos: name, at least one scope, and a mandatory
 * expiry of at most `MAX_TOKEN_TTL_DAYS` (90) days, validated against the *server's* clock, never the
 * browser's — the `max` attribute here is only a client-side nicety, the create call still surfaces a
 * `TokenTtlTooLongError` from the server as a normal form error if it's ever wrong.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { MAX_TOKEN_TTL_DAYS, type TokenScopeDto } from '@prdm/contracts';
import { errorMessage } from '../api/error-message.js';
import { FormError } from './FormError.js';
import styles from '../styles/forms.module.css';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function defaultExpiryDate(): string {
  const date = new Date(Date.now() + MAX_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY);
  return date.toISOString().slice(0, 10);
}

export function TokenCreateForm({
  availableScopes,
  onCreate,
}: {
  availableScopes: readonly TokenScopeDto[];
  onCreate: (input: { name: string; scopes: TokenScopeDto[]; expiresAt: string }) => Promise<void>;
}): ReactElement {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<TokenScopeDto>>(new Set());
  const [expiryDate, setExpiryDate] = useState(defaultExpiryDate());
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameValid = name.trim().length > 0;
  const scopesValid = scopes.size > 0;

  function toggleScope(scope: TokenScopeDto): void {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!nameValid || !scopesValid) return;

    setSubmitting(true);
    try {
      const expiresAt = new Date(`${expiryDate}T23:59:59.999Z`).toISOString();
      await onCreate({ name: name.trim(), scopes: Array.from(scopes), expiresAt });
      setName('');
      setScopes(new Set());
      setExpiryDate(defaultExpiryDate());
      setTouched(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit} noValidate>
      <h3 className={styles.title}>Nuevo token</h3>
      <div className={styles.field}>
        <label htmlFor="token-name">Nombre</label>
        <input id="token-name" type="text" required value={name} data-touched={touched} onChange={(e) => setName(e.target.value)} />
        {touched && !nameValid && <span className={styles.hint}>Ingresá un nombre.</span>}
      </div>
      <fieldset className={styles.field}>
        <legend>Scopes</legend>
        {availableScopes.map((scope) => (
          <label key={scope}>
            <input type="checkbox" checked={scopes.has(scope)} onChange={() => toggleScope(scope)} /> {scope}
          </label>
        ))}
        {touched && !scopesValid && <span className={styles.hint}>Elegí al menos un scope.</span>}
      </fieldset>
      <div className={styles.field}>
        <label htmlFor="token-expiry">Vence</label>
        <input
          id="token-expiry"
          type="date"
          required
          max={defaultExpiryDate()}
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
        />
        <span className={styles.hint}>Máximo {MAX_TOKEN_TTL_DAYS} días.</span>
      </div>
      <FormError message={error} />
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={submitting}>
          Crear token
        </button>
      </div>
    </form>
  );
}
