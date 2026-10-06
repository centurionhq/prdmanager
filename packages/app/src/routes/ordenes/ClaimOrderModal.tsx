/** "Tomar orden" (SDD-086 §D2, FB-146): picks who the order is assigned to — the caller (`dev:<handle>`)
 * or an agent (`agent:<name>`) — instead of claiming blindly. The name is validated on confirm, like
 * `CompleteOrderModal`, with the same charset the server accepts for an actor. */
import { useId, useState, type ReactElement } from 'react';
import { Button, Modal, TextField } from '../../components/index.js';
import styles from './ClaimOrderModal.module.css';

const AGENT_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const AGENT_NAME_ERROR = 'Escribí el nombre del agente (letras, números, punto, guion o guion bajo, hasta 64).';

type ClaimMode = 'self' | 'agent';

export interface ClaimOrderModalProps {
  readonly open: boolean;
  readonly workOrderId: string;
  /** The session's handle; `null` disables the "Yo" option. */
  readonly handle: string | null;
  readonly submitting: boolean;
  /** Set once a submit attempt fails; cleared by the caller when the modal is reopened/closed. */
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (assignee: string) => void;
}

export function ClaimOrderModal({ open, workOrderId, handle, submitting, error, onClose, onConfirm }: ClaimOrderModalProps): ReactElement {
  const [chosenMode, setChosenMode] = useState<ClaimMode>('self');
  const [agentName, setAgentName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const groupName = useId();
  const handleNoteId = useId();

  const mode: ClaimMode = handle === null ? 'agent' : chosenMode;

  function handleClose(): void {
    setChosenMode('self');
    setAgentName('');
    setNameError(null);
    onClose();
  }

  function handleConfirm(): void {
    if (mode === 'self' && handle !== null) {
      onConfirm(`dev:${handle}`);
      return;
    }
    const name = agentName.trim();
    if (!AGENT_NAME_PATTERN.test(name)) {
      setNameError(AGENT_NAME_ERROR);
      return;
    }
    setNameError(null);
    onConfirm(`agent:${name}`);
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Tomar orden"
      description={`${workOrderId} pasa a estar en curso, asignada a quien elijas.`}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={handleConfirm}>
            Tomar orden
          </Button>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label="Asignar a"
        aria-describedby={handle === null ? handleNoteId : undefined}
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
          {handle === null ? 'Yo (sin handle)' : `Yo (dev:${handle})`}
        </label>
        <label className={styles.option}>
          <input type="radio" name={groupName} checked={mode === 'agent'} onChange={() => setChosenMode('agent')} />
          Un agente…
        </label>
      </div>
      {handle === null ? <p id={handleNoteId} className={styles.note}>Definí tu handle en Ajustes › Perfil.</p> : null}
      {mode === 'agent' ? (
        <TextField
          label="Nombre del agente"
          value={agentName}
          onChange={(value) => {
            setAgentName(value);
            setNameError(null);
          }}
          hint="Se asigna como agent:<nombre>."
          error={nameError}
        />
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
