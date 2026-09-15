import type { ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { TokenScope } from '../../data';
import styles from './TokensPage.module.css';
import { TokenScopeFieldset } from './TokenScopeFieldset';
import { useCreateTokenForm } from './useCreateTokenForm';

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

const EXPIRY_OPTIONS = [30, 60, 90] as const;

/** "Crear token" modal: nombre, scopes, rama and vencimiento (WO-306). */
export function CreateTokenModal({ open, existingNames = [], onClose, onCreate }: CreateTokenModalProps): ReactElement {
  const form = useCreateTokenForm(open, existingNames, onCreate);

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
          <Button type="button" variant="primary" onClick={form.handleSubmit}>
            Crear token
          </Button>
        </>
      }
    >
      <div className={styles.fieldGroup}>
        <label htmlFor="token-name" className={styles.label}>
          Nombre
        </label>
        <input id="token-name" className={styles.textInput} value={form.name} onChange={form.handleNameChange} />
        {form.error ? (
          <p role="alert" className={styles.fieldError}>
            {form.error}
          </p>
        ) : null}
      </div>

      <TokenScopeFieldset scopes={form.scopes} onToggle={form.toggleScope} />

      <div className={styles.fieldGroup}>
        <label htmlFor="token-branch" className={styles.label}>
          Rama
        </label>
        <select id="token-branch" className={styles.textInput} value={form.branch} onChange={(event) => form.setBranch(event.target.value)}>
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
          value={form.expiresInDays}
          onChange={(event) => form.setExpiresInDays(Number(event.target.value))}
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
