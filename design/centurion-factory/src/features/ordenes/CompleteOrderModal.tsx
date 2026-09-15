import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import styles from './ActionModals.module.css';
import { COMMIT_SHA_ERROR, isValidCommitSha } from './actions';

export interface CompleteOrderModalProps {
  readonly open: boolean;
  readonly orderId: string;
  readonly onClose: () => void;
  readonly onConfirm: (sha: string) => void;
}

/** "Completar": asks for the commit SHA that carries the Refs: WO-xxx trailer (WO-292). */
export function CompleteOrderModal({ open, orderId, onClose, onConfirm }: CompleteOrderModalProps): ReactElement {
  const [sha, setSha] = useState('');
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const valid = isValidCommitSha(sha);

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
          <Button type="button" variant="primary" onClick={handleConfirm}>
            Completar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>
          {`SHA del commit con Refs: ${orderId}`}
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
    </Modal>
  );
}
