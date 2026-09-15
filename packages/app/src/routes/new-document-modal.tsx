/**
 * "Nuevo documento" modal (SDD-013 §"Documentos", WO-356): the trigger button and inline-validated form
 * from `Documentos.dc.html`, ported onto the shared `Modal`/`Button` primitives (WO-348) and the real
 * `createDocument` mutation. Keeps the exact accessible names ("Nuevo documento", "Tipo de documento",
 * "Título", "Crear") the full-journey E2E already drives.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { documentTitleSchema, TEMPLATE_DOCUMENT_KINDS, type DocumentDetail, type DocumentKind } from '@prdm/contracts';
import { Button, Modal } from '../components/index.js';
import { createDocument } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiMutation } from '../api/use-api-mutation.js';
import formStyles from '../styles/forms.module.css';

export interface NewDocumentModalProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly onCreated: (doc: DocumentDetail) => void;
}

const DEFAULT_KIND: DocumentKind = TEMPLATE_DOCUMENT_KINDS[0] ?? 'MRD';

export function NewDocumentModal({ orgSlug, projectSlug, onCreated }: NewDocumentModalProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>(DEFAULT_KIND);
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useApiMutation((input: { kind: DocumentKind; title: string }) => createDocument(orgSlug, projectSlug, input), {
    invalidate: [`documents:${orgSlug}:${projectSlug}`],
  });

  const titleValid = documentTitleSchema.safeParse(title).success;

  function close(): void {
    setOpen(false);
    setKind(DEFAULT_KIND);
    setTitle('');
    setTouched(false);
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    if (!titleValid) return;

    const document = await mutation.mutate({ kind, title });
    onCreated(document);
    close();
  }

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Nuevo documento
      </Button>
      <Modal open={open} title="Nuevo documento" onClose={close}>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className={formStyles.field}>
            <label htmlFor="new-document-kind">Tipo de documento</label>
            <select id="new-document-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {TEMPLATE_DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className={formStyles.field}>
            <label htmlFor="new-document-title">Título</label>
            <input
              id="new-document-title"
              type="text"
              required
              value={title}
              data-touched={touched}
              aria-describedby={touched && !titleValid ? 'new-document-title-hint' : undefined}
              aria-invalid={touched && !titleValid}
              onChange={(e) => setTitle(e.target.value)}
            />
            {touched && !titleValid && (
              <span id="new-document-title-hint" className={formStyles.hint}>
                Ingresá un título (máx. 300 caracteres).
              </span>
            )}
          </div>
          {mutation.status === 'error' && (
            <p role="alert" className={formStyles.error}>
              {errorMessage(mutation.error)}
            </p>
          )}
          <div className={formStyles.actions}>
            <Button type="button" variant="secondary" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.status === 'cargando'}>
              Crear
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
