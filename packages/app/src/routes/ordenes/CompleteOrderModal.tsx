/** "Completar orden" (SDD-013, WO-360): asks for the commit sha carrying `Refs: <id>`, then calls
 * `completeWorkOrder`. A `409 commit_not_verified_by_ci` response is shown as an explanation, not a
 * generic error — the commit exists but hasn't gone through the next CI report on the default branch yet. */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components/index.js';
import styles from './CompleteOrderModal.module.css';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_SHA_ERROR = 'Pegá el SHA del commit (7 a 40 caracteres hexadecimales).';

export interface CompleteOrderModalProps {
  readonly open: boolean;
  readonly workOrderId: string;
  readonly submitting: boolean;
  /** Set once a submit attempt fails; cleared by the caller when the modal is reopened/closed. */
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (sha: string) => void;
}

export function CompleteOrderModal({ open, workOrderId, submitting, error, onClose, onConfirm }: CompleteOrderModalProps): ReactElement {
  const [sha, setSha] = useState('');
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const valid = COMMIT_SHA_PATTERN.test(sha.trim());

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    setSha(event.target.value);
  }

  function handleConfirm(): void {
    setTouched(true);
    if (!valid) return;
    onConfirm(sha.trim());
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Completar orden"
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={handleConfirm}>
            Completar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>
          {`SHA del commit con Refs: ${workOrderId}`}
        </label>
        <input
          id={inputId}
          className={styles.input}
          value={sha}
          onChange={handleChange}
          aria-invalid={touched && !valid}
          aria-describedby={touched && !valid ? errorId : undefined}
        />
        {touched && !valid ? (
          <span id={errorId} className={styles.error} role="alert">
            {COMMIT_SHA_ERROR}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className={styles.conflict} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
