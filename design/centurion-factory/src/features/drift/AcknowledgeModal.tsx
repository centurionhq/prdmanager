import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import { getPerson } from '../../data';
import type { AcknowledgeTarget } from './drift-issue-groups';
import { PROJECT_TARGET } from './drift-issue-groups';
import styles from './AcknowledgeModal.module.css';

const ACKNOWLEDGED_BY = getPerson('ana-rios')?.name ?? 'Ana Ríos';

function explanationFor(target: string, headSha: string): string {
  const subject = target === PROJECT_TARGET ? 'del proyecto' : `de ${target}`;
  return `La línea base ${subject} avanza al commit ${headSha}. Las órdenes fuera de sincronía siguen abiertas hasta que alguien las retome.`;
}

export interface AcknowledgeModalProps {
  readonly open: boolean;
  readonly targets: readonly AcknowledgeTarget[];
  readonly headSha: string;
  readonly onClose: () => void;
  readonly onConfirm: (target: string) => void;
}

/** "Reconocer drift" (WO-294): picks a blueprint or the whole project and advances its baseline. */
export function AcknowledgeModal({ open, targets, headSha, onClose, onConfirm }: AcknowledgeModalProps): ReactElement {
  const firstTarget = targets[0]?.value ?? PROJECT_TARGET;
  const [target, setTarget] = useState(firstTarget);
  const selectId = useId();

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    setTarget(event.target.value);
  }

  function handleConfirm(): void {
    onConfirm(target);
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
          <Button type="button" variant="primary" onClick={handleConfirm}>
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
      <p className={styles.explanation}>{explanationFor(target, headSha)}</p>
      <p className={styles.audit}>Queda registrado a nombre de {ACKNOWLEDGED_BY} en el historial de drift.</p>
    </Modal>
  );
}
