import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import { isValidSlug, slugify } from './lib';
import styles from './ProyectosPage.module.css';

export interface NewProjectInput {
  readonly name: string;
  readonly slug: string;
}

export interface NewProjectModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: NewProjectInput) => void;
}

const SLUG_ERROR = 'Usá minúsculas, números y guiones.';

/** "Nuevo proyecto" modal: name plus an auto-derived, editable slug (WO-303). */
export function NewProjectModal({ open, onClose, onCreate }: NewProjectModalProps): ReactElement {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName('');
    setSlug('');
    setSlugTouched(false);
    setError(undefined);
  }, [open]);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(event: ChangeEvent<HTMLInputElement>): void {
    setSlugTouched(true);
    setSlug(event.target.value);
  }

  function handleSubmit(): void {
    if (!isValidSlug(slug)) {
      setError(SLUG_ERROR);
      return;
    }
    onCreate({ name: name.trim() || slug, slug });
  }

  return (
    <Modal
      open={open}
      title="Nuevo proyecto"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit}>
            Crear proyecto
          </Button>
        </>
      }
    >
      <div className={styles.fieldGroup}>
        <label htmlFor="new-project-name" className={styles.label}>
          Nombre
        </label>
        <input id="new-project-name" className={styles.textInput} value={name} onChange={handleNameChange} />
      </div>
      <div className={styles.fieldGroup}>
        <label htmlFor="new-project-slug" className={styles.label}>
          Slug
        </label>
        <input id="new-project-slug" className={styles.textInput} value={slug} onChange={handleSlugChange} />
        {error ? (
          <p role="alert" className={styles.fieldError}>
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
