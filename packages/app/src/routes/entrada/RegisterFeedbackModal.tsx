/** "Registrar feedback" (SDD-013, WO-362): a manual `submitFeedback` call for feedback that didn't
 * arrive through the MCP or the CLI. */
import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components/index.js';
import styles from './RegisterFeedbackModal.module.css';

export interface RegisterFeedbackModalProps {
  readonly open: boolean;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (input: { readonly text: string; readonly source: string; readonly title?: string; readonly customer?: string }) => void;
}

export function RegisterFeedbackModal({ open, submitting, error, onClose, onConfirm }: RegisterFeedbackModalProps): ReactElement {
  const sourceId = useId();
  const titleId = useId();
  const textId = useId();
  const customerId = useId();
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [customer, setCustomer] = useState('');
  const [touched, setTouched] = useState(false);

  const canConfirm = source.trim().length > 0 && text.trim().length > 0;

  function reset(): void {
    setSource('');
    setTitle('');
    setText('');
    setCustomer('');
    setTouched(false);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  function handleConfirm(): void {
    setTouched(true);
    if (!canConfirm) return;
    onConfirm({
      text: text.trim(),
      source: source.trim(),
      title: title.trim() || undefined,
      customer: customer.trim() || undefined,
    });
  }

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
          <Button type="button" variant="primary" disabled={submitting} onClick={handleConfirm}>
            Registrar feedback
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={sourceId} className={styles.label}>
          Fuente
        </label>
        <input id={sourceId} className={styles.input} value={source} onChange={(event: ChangeEvent<HTMLInputElement>) => setSource(event.target.value)} />
        {touched && source.trim().length === 0 ? <span className={styles.error}>Ingresá de dónde viene el feedback (Slack, email, reunión…).</span> : null}
      </div>
      <div className={styles.field}>
        <label htmlFor={titleId} className={styles.label}>
          Título (opcional)
        </label>
        <input id={titleId} className={styles.input} value={title} onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={textId} className={styles.label}>
          Texto
        </label>
        <textarea id={textId} className={styles.textarea} value={text} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)} />
        {touched && text.trim().length === 0 ? <span className={styles.error}>Pegá el texto del feedback.</span> : null}
      </div>
      <div className={styles.field}>
        <label htmlFor={customerId} className={styles.label}>
          Cliente (opcional)
        </label>
        <input id={customerId} className={styles.input} value={customer} onChange={(event: ChangeEvent<HTMLInputElement>) => setCustomer(event.target.value)} />
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
