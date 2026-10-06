/**
 * "Tomar orden" (SDD-086 §D2, FB-146): the order is assigned either to the signed-in person, as
 * `dev:<handle>`, or to an agent, as `agent:<name>`. The agent name is validated on confirm — like
 * `CompleteOrderModal` — with the same charset the server accepts for an actor. Without a session
 * handle the «Yo» option is unavailable and the reason stays visible, so delegating to an agent is
 * still one step away instead of a dead end.
 */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { ActorRef } from '../../data';
import styles from './ActionModals.module.css';
import { AGENT_NAME_ERROR, devActor, isValidAgentName } from './actions';

type TakeOrderMode = 'self' | 'agent';

export interface TakeOrderModalProps {
  readonly open: boolean;
  readonly orderId: string;
  /** The session's handle; `null` disables the «Yo» option and explains why. */
  readonly handle: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (assignee: ActorRef) => void;
}

export function TakeOrderModal({ open, orderId, handle, onClose, onConfirm }: TakeOrderModalProps): ReactElement {
  const [chosenMode, setChosenMode] = useState<TakeOrderMode>('self');
  const [agentName, setAgentName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const groupName = useId();
  const noteId = useId();
  const inputId = useId();
  const errorId = useId();

  // Without a handle «Yo» is not an option: the agent form is the only one left.
  const mode: TakeOrderMode = handle === null ? 'agent' : chosenMode;

  function handleClose(): void {
    setChosenMode('self');
    setAgentName('');
    setNameError(null);
    onClose();
  }

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setAgentName(event.target.value);
    setNameError(null);
  }

  function handleConfirm(): void {
    if (mode === 'self' && handle !== null) {
      onConfirm(devActor(handle));
      return;
    }
    if (!isValidAgentName(agentName)) {
      setNameError(AGENT_NAME_ERROR);
      return;
    }
    setNameError(null);
    onConfirm(`agent:${agentName.trim()}`);
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Tomar orden"
      description={`${orderId} pasa a estar en curso, asignada a quien elijas.`}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm}>
            Tomar orden
          </Button>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label="Asignar a"
        aria-describedby={handle === null ? noteId : undefined}
        className={styles.group}
      >
        <label className={[styles.option, handle === null ? styles.optionDisabled : ''].join(' ')}>
          <input
            type="radio"
            name={groupName}
            disabled={handle === null}
            checked={mode === 'self'}
            onChange={() => setChosenMode('self')}
          />
          {handle === null ? 'Yo (sin handle)' : `Yo (${devActor(handle)})`}
        </label>
        <label className={styles.option}>
          <input type="radio" name={groupName} checked={mode === 'agent'} onChange={() => setChosenMode('agent')} />Un agente…
        </label>
      </div>
      {handle === null ? (
        <p id={noteId} className={styles.note}>
          Definí tu handle en Ajustes › Perfil.
        </p>
      ) : null}
      {mode === 'agent' ? (
        <div className={styles.field}>
          <label htmlFor={inputId} className={styles.label}>
            Nombre del agente
          </label>
          <input
            id={inputId}
            className={styles.input}
            value={agentName}
            onChange={handleNameChange}
            placeholder="claude"
            aria-invalid={nameError === null ? undefined : true}
            aria-describedby={nameError === null ? undefined : errorId}
          />
          <span className={styles.help}>
            Se asigna como <span className="id">agent:&lt;nombre&gt;</span>.
          </span>
          {nameError === null ? null : (
            <span id={errorId} className={styles.error} role="alert">
              {nameError}
            </span>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
