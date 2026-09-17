/** "Autorizar force-push" (WO-181): the audited admin override for a CI baseline report whose head_sha
 * doesn't verify as a fast-forward of the registered baseline head (see `authorizeForcePushOverride`'s
 * own doc comment). No endpoint exposes which head_sha a rejected report actually was — the admin pastes
 * it in from the failing CI job's own log line (`code report rejected: ... responded 409`) or from
 * `git log` on the branch that was pushed. */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components/index.js';
import styles from './AcknowledgeModal.module.css';

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export interface ForcePushOverrideModalProps {
  readonly open: boolean;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (headSha: string) => void;
}

export function ForcePushOverrideModal({ open, submitting, onClose, onConfirm }: ForcePushOverrideModalProps): ReactElement {
  const [headSha, setHeadSha] = useState('');
  const inputId = useId();
  const isValid = SHA_PATTERN.test(headSha.trim());

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    setHeadSha(event.target.value);
  }

  function handleClose(): void {
    setHeadSha('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Autorizar force-push"
      onClose={handleClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting || !isValid} onClick={() => onConfirm(headSha.trim())}>
            Autorizar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>
          Commit (head_sha) a autorizar
        </label>
        <input
          id={inputId}
          type="text"
          className={styles.select}
          placeholder="ej. 821e376..."
          value={headSha}
          onChange={handleChange}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <p className={styles.explanation}>
        El reporte de CI para este commit fue rechazado porque su historial no verificó como un fast-forward de la línea base
        registrada. Pegá el sha exacto que reportó el job de CI que falló (visible en su log, o con <code>git log</code> en la
        rama que se pusheó).
      </p>
      <p className={styles.audit}>Queda registrado en el historial de auditoría.</p>
    </Modal>
  );
}
