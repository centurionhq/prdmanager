/**
 * "Nuevo documento" modal (WO-286): a kind select plus a validated title. Creating a document is
 * a local state mutation owned by DocumentosPage; this component only reports the submitted
 * values once they pass validation.
 */
import { useId, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import styles from './NewDocumentModal.module.css';
import { DOCUMENT_KINDS, kindLabel, type ListedDocumentKind } from './helpers';

export interface NewDocumentModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (kind: ListedDocumentKind, title: string) => void;
}

const MIN_TITLE_LENGTH = 8;
const TITLE_ERROR = 'Escribí un título de al menos 8 caracteres.';

export function NewDocumentModal({ open, onClose, onCreate }: NewDocumentModalProps): ReactElement {
  const [kind, setKind] = useState<ListedDocumentKind>('MRD');
  const [title, setTitle] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const formId = useId();
  const kindId = useId();
  const titleId = useId();
  const errorId = useId();

  const isTitleValid = title.trim().length >= MIN_TITLE_LENGTH;
  const showError = submitted && !isTitleValid;

  function resetAndClose(): void {
    setKind('MRD');
    setTitle('');
    setSubmitted(false);
    onClose();
  }

  function handleKindChange(event: ChangeEvent<HTMLSelectElement>): void {
    setKind(event.target.value as ListedDocumentKind);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitted(true);
    if (!isTitleValid) return;
    onCreate(kind, title.trim());
    resetAndClose();
  }

  return (
    <Modal
      open={open}
      title="Nuevo documento"
      onClose={resetAndClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="primary">
            Crear
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={kindId}>
            Tipo
          </label>
          <select id={kindId} className={styles.select} value={kind} onChange={handleKindChange}>
            {DOCUMENT_KINDS.map((option) => (
              <option key={option} value={option}>
                {kindLabel(option)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={titleId}>
            Título
          </label>
          <input
            id={titleId}
            className={styles.input}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={showError ? true : undefined}
            aria-describedby={showError ? errorId : undefined}
          />
          {showError ? (
            <span id={errorId} className={styles.error} role="alert">
              {TITLE_ERROR}
            </span>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
