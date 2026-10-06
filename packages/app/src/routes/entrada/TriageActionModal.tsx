/** Dismiss / mark-duplicate confirmation (SDD-065 D5/D7), shared by the per-row and batch flows. It is only
 * mounted while an action is pending, so its field state starts fresh every time. */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components/index.js';
import styles from './TriageActionModal.module.css';

const DUPLICATE_ID_PATTERN = /^[A-Z]{2,4}-\d{3,9}$/;
const DUPLICATE_ID_ERROR = 'Ingresá el id del duplicado (por ejemplo FB-018).';

export interface TriageActionInput {
  readonly reason?: string;
  readonly duplicateOf?: string;
}

export interface TriageActionModalProps {
  readonly mode: 'dismiss' | 'duplicate';
  readonly ids: readonly string[];
  readonly targetLabel: string;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (input: TriageActionInput) => void;
}

export function TriageActionModal({ mode, ids, targetLabel, submitting, error, onClose, onConfirm }: TriageActionModalProps): ReactElement {
  const fieldId = useId();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const isDismiss = mode === 'dismiss';
  const idInvalid = !isDismiss && !DUPLICATE_ID_PATTERN.test(value.trim());

  function handleConfirm(): void {
    if (isDismiss) {
      onConfirm({ reason: value.trim() || undefined });
      return;
    }
    setTouched(true);
    if (idInvalid) return;
    onConfirm({ duplicateOf: value.trim() });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isDismiss ? 'Descartar ítem' : 'Marcar duplicado'}
      description={ids.length > 1 ? `${targetLabel} (${ids.join(', ')})` : targetLabel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={handleConfirm}>
            {isDismiss ? 'Descartar' : 'Marcar duplicado'}
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={fieldId} className={styles.label}>
          {isDismiss ? 'Motivo (opcional)' : 'Id del duplicado'}
        </label>
        {isDismiss ? (
          <textarea
            id={fieldId}
            name="reason"
            className={styles.textarea}
            value={value}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
          />
        ) : (
          <input
            id={fieldId}
            name="duplicateOf"
            className={styles.input}
            value={value}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
          />
        )}
        {touched && idInvalid ? <span className={styles.fieldError}>{DUPLICATE_ID_ERROR}</span> : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
