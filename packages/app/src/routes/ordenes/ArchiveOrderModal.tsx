/** "Archivar orden" (SDD-064 §WO-B, FB-069): confirms the archive and takes an optional motive — the
 * same shape `archiveWorkOrder` accepts server-side (`archiveWorkOrderInputSchema.reason`). Archiving is
 * only offered from the drawer for `pending`/`in_progress`/`out_of_sync` orders, matching
 * `@prdm/core`'s own lifecycle rule. */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components/index.js';
import styles from './ArchiveOrderModal.module.css';

/** Mirrors `archiveWorkOrderInputSchema`'s own 2000-character cap so the client never sends a body the
 * server will reject with a bare "invalid body". */
const REASON_MAX_LENGTH = 2000;

export interface ArchiveOrderModalProps {
  readonly open: boolean;
  readonly workOrderId: string;
  /** A gate closes with evidence (SDD-093 D8): the motive is mandatory and must name it. */
  readonly reasonRequired?: boolean;
  readonly submitting: boolean;
  /** Set once a submit attempt fails; cleared by the caller when the modal is reopened/closed. */
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (reason?: string) => void;
}

export function ArchiveOrderModal({ open, workOrderId, reasonRequired = false, submitting, error, onClose, onConfirm }: ArchiveOrderModalProps): ReactElement {
  const [reason, setReason] = useState('');
  const inputId = useId();
  const hintId = useId();

  function reset(): void {
    setReason('');
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  function handleConfirm(): void {
    const trimmed = reason.trim();
    onConfirm(trimmed.length > 0 ? trimmed : undefined);
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Archivar orden"
      description={`${workOrderId} sale de la lista activa y queda en solo lectura en el grafo.`}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting || (reasonRequired && reason.trim() === '')} onClick={handleConfirm}>
            Archivar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>
          {reasonRequired ? 'Motivo (obligatorio)' : 'Motivo (opcional)'}
        </label>
        <textarea
          id={inputId}
          className={styles.textarea}
          value={reason}
          maxLength={REASON_MAX_LENGTH}
          required={reasonRequired}
          aria-describedby={reasonRequired ? hintId : undefined}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
        />
        {reasonRequired ? (
          <p id={hintId} className={styles.hint}>
            El motivo tiene que nombrar la evidencia: el comando y su salida, o el ART del gate.
          </p>
        ) : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
