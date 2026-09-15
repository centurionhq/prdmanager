/** "Reconocer drift" (SDD-013, WO-361): picks a blueprint (or the whole project) and advances its
 * baseline via `acknowledgeDrift`. Explains that the baseline moves forward before confirming — the
 * out-of-sync work orders it leaves behind stay open until someone retakes them. */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components/index.js';
import { PROJECT_TARGET, type AcknowledgeTarget } from './drift-groups.js';
import styles from './AcknowledgeModal.module.css';

export interface AcknowledgeModalProps {
  readonly open: boolean;
  readonly targets: readonly AcknowledgeTarget[];
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (target: string) => void;
}

function explanationFor(target: string): string {
  const subject = target === PROJECT_TARGET ? 'del proyecto' : `de ${target}`;
  return `La línea base ${subject} avanza al último commit reportado. Las órdenes fuera de sincronía siguen abiertas hasta que alguien las retome.`;
}

export function AcknowledgeModal({ open, targets, submitting, onClose, onConfirm }: AcknowledgeModalProps): ReactElement {
  const firstTarget = targets[0]?.value ?? PROJECT_TARGET;
  const [target, setTarget] = useState(firstTarget);
  const selectId = useId();

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    setTarget(event.target.value);
  }

  return (
    <Modal
      open={open}
      title="Reconocer drift"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={() => onConfirm(target)}>
            Reconocer drift
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={selectId} className={styles.label}>
          Qué reconocer
        </label>
        <select id={selectId} className={styles.select} value={target} onChange={handleChange}>
          {targets.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p className={styles.explanation}>{explanationFor(target)}</p>
      <p className={styles.audit}>Queda registrado en el historial de drift.</p>
    </Modal>
  );
}
