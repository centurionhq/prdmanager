import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { ActorRef } from '../../data';
import styles from './ActionModals.module.css';
import { ASSIGNABLE_ACTORS } from './actions';

export interface TakeOrderModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (assignee: ActorRef) => void;
}

/** "Tomar orden": picks who the pending order goes to (WO-292). */
export function TakeOrderModal({ open, onClose, onConfirm }: TakeOrderModalProps): ReactElement {
  const [assignee, setAssignee] = useState<ActorRef>(ASSIGNABLE_ACTORS[0] ?? 'agent:claude');
  const selectId = useId();

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    setAssignee(event.target.value as ActorRef);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tomar orden"
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={() => onConfirm(assignee)}>
            Tomar orden
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={selectId} className={styles.label}>
          Asignar a
        </label>
        <select id={selectId} className={styles.select} value={assignee} onChange={handleChange}>
          {ASSIGNABLE_ACTORS.map((actor) => (
            <option key={actor} value={actor}>
              {actor}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
