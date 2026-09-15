import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { TokenScope } from '../../data';
import styles from './TokensPage.module.css';

export interface CreateTokenInput {
  readonly name: string;
  readonly scopes: readonly TokenScope[];
  readonly branch: string;
  readonly expiresInDays: number;
}

export interface CreateTokenModalProps {
  readonly open: boolean;
  readonly existingNames?: readonly string[];
  readonly onClose: () => void;
  readonly onCreate: (input: CreateTokenInput) => void;
}

const SCOPE_OPTIONS: readonly TokenScope[] = ['reports:write', 'reports:baseline', 'governance:read', 'mcp:read'];
const EXPIRY_OPTIONS = [30, 60, 90] as const;
const NAME_ERROR = 'Ponele un nombre al token.';
const DUPLICATE_NAME_ERROR = 'Ya existe un token con ese nombre.';

function toggleScope(scopes: readonly TokenScope[], scope: TokenScope): readonly TokenScope[] {
  return scopes.includes(scope) ? scopes.filter((entry) => entry !== scope) : [...scopes, scope];
}

/** "Crear token" modal: nombre, scopes, rama and vencimiento (WO-306). */
export function CreateTokenModal({ open, existingNames = [], onClose, onCreate }: CreateTokenModalProps): ReactElement {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<readonly TokenScope[]>([]);
  const [branch, setBranch] = useState('main');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName('');
    setScopes([]);
    setBranch('main');
    setExpiresInDays(30);
    setError(undefined);
  }, [open]);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value);
    setError(undefined);
  }

  function handleSubmit(): void {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError(NAME_ERROR);
      return;
    }
    const isDuplicate = existingNames.some((existing) => existing.toLowerCase() === trimmedName.toLowerCase());
    if (isDuplicate) {
      setError(DUPLICATE_NAME_ERROR);
      return;
    }
    onCreate({ name: trimmedName, scopes, branch, expiresInDays });
  }

  return (
    <Modal
      open={open}
      title="Crear token"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit}>
            Crear token
          </Button>
        </>
      }
    >
      <div className={styles.fieldGroup}>
        <label htmlFor="token-name" className={styles.label}>
          Nombre
        </label>
        <input id="token-name" className={styles.textInput} value={name} onChange={handleNameChange} />
        {error ? (
          <p role="alert" className={styles.fieldError}>
            {error}
          </p>
        ) : null}
      </div>

      <fieldset className={`${styles.fieldGroup} ${styles.fieldset}`}>
        <legend className={styles.label}>Alcance</legend>
        <div className={styles.scopeList}>
          {SCOPE_OPTIONS.map((scope) => (
            <label key={scope} className={styles.scopeOption}>
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => setScopes((current) => toggleScope(current, scope))}
              />
              <span className="id">{scope}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.fieldGroup}>
        <label htmlFor="token-branch" className={styles.label}>
          Rama
        </label>
        <select id="token-branch" className={styles.textInput} value={branch} onChange={(event) => setBranch(event.target.value)}>
          <option value="main">main</option>
          <option value="cualquier rama">Cualquier rama</option>
        </select>
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="token-expiry" className={styles.label}>
          Vencimiento
        </label>
        <select
          id="token-expiry"
          className={styles.textInput}
          value={expiresInDays}
          onChange={(event) => setExpiresInDays(Number(event.target.value))}
        >
          {EXPIRY_OPTIONS.map((days) => (
            <option key={days} value={days}>
              {days} días
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
