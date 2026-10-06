/**
 * Confirmation for the batch bar of Órdenes (SDD-086 §D6, FB-147): *Archivar* takes an optional motive —
 * the same shape `archiveWorkOrderInputSchema.reason` accepts — and *Tomar* picks the assignee exactly
 * like the single-order `ClaimOrderModal`: the caller (`dev:<handle>`) by default, an `agent:<name>`
 * otherwise. Both actions go through `POST .../work-orders/batch`, so this modal never knows about
 * single orders. It is only mounted while an action is pending, so its fields start fresh every time.
 */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal, TextField } from '../../components/index.js';
import styles from './BatchOrderModal.module.css';

/** Same charset the server accepts for an actor (`@prdm/contracts`'s `ACTOR_PATTERN`, name part only). */
const AGENT_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const AGENT_NAME_ERROR = 'Escribí el nombre del agente (letras, números, punto, guion o guion bajo, hasta 64).';
/** Mirrors `archiveWorkOrderInputSchema`'s own 2000-character cap, so the client never sends a body the
 * server rejects with a bare "invalid body". */
const REASON_MAX_LENGTH = 2000;

export type BatchOrderAction = 'archive' | 'claim';

export interface BatchOrderInput {
  readonly reason?: string;
  readonly assignee?: string;
}

export interface BatchOrderModalProps {
  readonly action: BatchOrderAction;
  /** The selection the batch is about; its size is what the copy counts. */
  readonly ids: readonly string[];
  /** The session's handle; `null` disables the "Yo" option, like `ClaimOrderModal`. */
  readonly handle: string | null;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (input: BatchOrderInput) => void;
}

type ClaimMode = 'self' | 'agent';

function selectedLabel(count: number): string {
  return count === 1 ? 'La orden seleccionada' : `Las ${count} órdenes seleccionadas`;
}

export function BatchOrderModal({ action, ids, handle, submitting, error, onClose, onConfirm }: BatchOrderModalProps): ReactElement {
  const [reason, setReason] = useState('');
  const [chosenMode, setChosenMode] = useState<ClaimMode>('self');
  const [agentName, setAgentName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const reasonId = useId();
  const groupName = useId();
  const handleNoteId = useId();
  const isArchive = action === 'archive';
  const mode: ClaimMode = handle === null ? 'agent' : chosenMode;

  function handleConfirm(): void {
    if (isArchive) {
      const trimmed = reason.trim();
      onConfirm(trimmed.length > 0 ? { reason: trimmed } : {});
      return;
    }
    if (mode === 'self' && handle !== null) {
      onConfirm({ assignee: `dev:${handle}` });
      return;
    }
    const name = agentName.trim();
    if (!AGENT_NAME_PATTERN.test(name)) {
      setNameError(AGENT_NAME_ERROR);
      return;
    }
    setNameError(null);
    onConfirm({ assignee: `agent:${name}` });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isArchive ? 'Archivar órdenes' : 'Tomar órdenes'}
      description={
        isArchive
          ? `${selectedLabel(ids.length)} salen de la lista activa y quedan en solo lectura en el grafo.`
          : `${selectedLabel(ids.length)} pasan a estar en curso, asignadas a quien elijas.`
      }
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={handleConfirm}>
            {isArchive ? 'Archivar' : 'Tomar órdenes'}
          </Button>
        </>
      }
    >
      {isArchive ? (
        <div className={styles.field}>
          <label htmlFor={reasonId} className={styles.label}>
            Motivo (opcional)
          </label>
          <textarea
            id={reasonId}
            name="reason"
            className={styles.textarea}
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
          />
        </div>
      ) : (
        <>
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
        </>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
