import type { ReactElement } from 'react';
import { Button, Modal } from '../../components';
import styles from './ProyectosPage.module.css';
import { useNewProjectForm } from './useNewProjectForm';

export interface NewProjectInput {
  readonly name: string;
  readonly slug: string;
}

export interface NewProjectModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: NewProjectInput) => void;
}

/** "Nuevo proyecto" modal: name plus an auto-derived, editable slug (WO-303). */
export function NewProjectModal({ open, onClose, onCreate }: NewProjectModalProps): ReactElement {
  const form = useNewProjectForm(open, onCreate);

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
          <Button type="button" variant="primary" onClick={form.handleSubmit}>
            Crear proyecto
          </Button>
        </>
      }
    >
      <div className={styles.fieldGroup}>
        <label htmlFor="new-project-name" className={styles.label}>
          Nombre
        </label>
        <input id="new-project-name" className={styles.textInput} value={form.name} onChange={form.handleNameChange} />
      </div>
      <div className={styles.fieldGroup}>
        <label htmlFor="new-project-slug" className={styles.label}>
          Slug
        </label>
        <input id="new-project-slug" className={styles.textInput} value={form.slug} onChange={form.handleSlugChange} />
        {form.error ? (
          <p role="alert" className={styles.fieldError}>
            {form.error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
