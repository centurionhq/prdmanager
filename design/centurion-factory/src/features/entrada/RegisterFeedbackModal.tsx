import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { ArtifactSource } from '../../data';
import styles from './EntradaModals.module.css';
import { sourceLabel } from './SourceIcon';

export interface RegisterFeedbackInput {
  readonly title: string;
  readonly body: string;
  readonly source: ArtifactSource | 'chat';
}

export interface RegisterFeedbackModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (input: RegisterFeedbackInput) => void;
}

const SOURCE_OPTIONS: readonly (ArtifactSource | 'chat')[] = ['meeting', 'email', 'slack', 'call', 'doc', 'chat', 'other'];

/** "Registrar feedback": título, texto y fuente, para dar de alta feedback manualmente (WO-295). */
export function RegisterFeedbackModal({ open, onClose, onConfirm }: RegisterFeedbackModalProps): ReactElement {
  const titleId = useId();
  const bodyId = useId();
  const sourceId = useId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState<ArtifactSource | 'chat'>('other');

  function reset(): void {
    setTitle('');
    setBody('');
    setSource('other');
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  function handleConfirm(): void {
    onConfirm({ title: title.trim(), body: body.trim(), source });
    reset();
  }

  const canConfirm = title.trim().length > 0 && body.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Registrar feedback"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={!canConfirm} onClick={handleConfirm}>
            Registrar feedback
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={titleId} className={styles.label}>
          Título
        </label>
        <input id={titleId} className={styles.input} value={title} onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={bodyId} className={styles.label}>
          Texto
        </label>
        <textarea id={bodyId} className={styles.textarea} value={body} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBody(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={sourceId} className={styles.label}>
          Fuente
        </label>
        <select id={sourceId} className={styles.select} value={source} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSource(event.target.value as ArtifactSource | 'chat')}>
          {SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {sourceLabel(option)}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
