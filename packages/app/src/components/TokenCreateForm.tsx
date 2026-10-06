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
import { Button, Panel, TextField } from './index.js';
import { FormError } from './FormError.js';
import styles from './TokenCreateForm.module.css';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const CEILING_MARGIN_MS = 60 * 1000;

/** The server refuses anything past `now + 90 days` on *its* clock. A day picked in the form means "until the
 * end of that day", which for the last allowed day lies hours past that ceiling -- so what is sent is capped
 * a minute under it. Without the cap, leaving the proposed date untouched was always refused. */
function expiryInstant(expiryDate: string): string {
  const endOfDay = new Date(`${expiryDate}T23:59:59.999Z`).getTime();
  const ceiling = Date.now() + MAX_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY - CEILING_MARGIN_MS;
  return new Date(Math.min(endOfDay, ceiling)).toISOString();
}

function defaultExpiryDate(): string {
  const date = new Date(Date.now() + MAX_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY);
  return date.toISOString().slice(0, 10);
}

export function TokenCreateForm({
  availableScopes,
  onCreate,
  onCancel,
}: {
  availableScopes: readonly TokenScopeDto[];
  onCreate: (input: { name: string; scopes: TokenScopeDto[]; expiresAt: string }) => Promise<void>;
  /** Closes the form without creating anything. */
  onCancel?: () => void;
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
      const expiresAt = expiryInstant(expiryDate);
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
    <Panel>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <h3 className={styles.title}>Nuevo token</h3>
        <TextField label="Nombre" value={name} onChange={setName} required error={touched && !nameValid ? 'Ingresá un nombre.' : null} />

        <fieldset className={styles.scopes} aria-describedby={touched && !scopesValid ? 'token-scopes-hint' : undefined}>
          <legend className={styles.legend}>Scopes</legend>
          {availableScopes.map((scope) => (
            <label key={scope} className={styles.scope}>
              <input type="checkbox" checked={scopes.has(scope)} onChange={() => toggleScope(scope)} />
              <span className="id">{scope}</span>
            </label>
          ))}
          {touched && !scopesValid ? (
            <p id="token-scopes-hint" role="alert" className={styles.error}>
              Elegí al menos un scope.
            </p>
          ) : null}
        </fieldset>

        <TextField label="Vence" type="date" value={expiryDate} onChange={setExpiryDate} required max={defaultExpiryDate()} hint={`Máximo ${MAX_TOKEN_TTL_DAYS} días.`} />

        <FormError message={error} />
        <div className={styles.actions}>
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={submitting}>
            Crear token
          </Button>
        </div>
      </form>
    </Panel>
  );
}
