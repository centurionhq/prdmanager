import { useEffect, useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import styles from './ArchiveOrderModal.module.css';

/** Cap of the motive, matching the server-side contract. */
const REASON_MAX_LENGTH = 2000;

export interface ArchiveOrderModalProps {
  readonly open: boolean;
  readonly orderId: string;
  readonly onClose: () => void;
  readonly onConfirm: (reason?: string) => void;
}

/** "Archivar": the order leaves the active queue; the motive is optional (SDD-064, FB-069). */
export function ArchiveOrderModal({ open, orderId, onClose, onConfirm }: ArchiveOrderModalProps): ReactElement {
  const [reason, setReason] = useState('');
  const inputId = useId();

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setReason(event.target.value);
  }

  function handleConfirm(): void {
    const trimmed = reason.trim();
    onConfirm(trimmed.length > 0 ? trimmed : undefined);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Archivar orden"
      description={`${orderId} sale de la lista activa: queda en solo lectura y la encontrás en el filtro Archivadas.`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm}>
            Archivar
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>
          Motivo (opcional)
        </label>
        <textarea id={inputId} className={styles.textarea} value={reason} maxLength={REASON_MAX_LENGTH} onChange={handleChange} />
      </div>
    </Modal>
  );
}
