/**
 * `/o/:orgSlug/p/:projectSlug/documents` (SDD-007 "Documentos y flujo", WO-141): every document in the
 * project, filterable by kind/workflow state, plus "Nuevo documento" (from `templateFor(kind)`, gated to
 * `edit_document`) linking to the read-only detail view.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import {
  can,
  documentTitleSchema,
  DOCUMENT_KINDS,
  DOCUMENT_WORKFLOW_STATES,
  TEMPLATE_DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentSummary,
  type DocumentWorkflowState,
  type PermissionSubject,
} from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { createDocument, getSession, listDocuments, listProjectMembers } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';
import styles from '../styles/dashboard.module.css';

const KIND_LABEL = 'Todos';
const STATE_LABEL = 'Todos';

function NewDocumentForm({ orgSlug, projectSlug, onCreated }: { orgSlug: string; projectSlug: string; onCreated: (doc: DocumentSummary) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>(TEMPLATE_DOCUMENT_KINDS[0] ?? 'MRD');
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleValid = documentTitleSchema.safeParse(title).success;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!titleValid) return;

    setSubmitting(true);
    try {
      const document = await createDocument(orgSlug, projectSlug, { kind, title });
      onCreated(document);
      setOpen(false);
      setTitle('');
      setTouched(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={formStyles.primaryButton} onClick={() => setOpen(true)}>
        Nuevo documento
      </button>
    );
  }

  return (
    <form className={formStyles.card} onSubmit={handleSubmit} noValidate>
      <h2 className={formStyles.title}>Nuevo documento</h2>
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
      <FormError message={error} />
      <div className={formStyles.actions}>
        <button type="button" className={formStyles.secondaryButton} onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <button type="submit" className={formStyles.primaryButton} disabled={submitting}>
          Crear
        </button>
      </div>
    </form>
  );
}

export function DocumentsList(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [subject, setSubject] = useState<PermissionSubject | null>(null);
  const [kindFilter, setKindFilter] = useState<DocumentKind | ''>('');
  const [stateFilter, setStateFilter] = useState<DocumentWorkflowState | ''>('');
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Documentos');

  async function reload(): Promise<void> {
    if (!projectSlug) return;
    try {
      const [session, members, docs] = await Promise.all([
        getSession(),
        listProjectMembers(orgSlug, projectSlug),
        listDocuments(orgSlug, projectSlug, { kind: kindFilter || undefined, workflowState: stateFilter || undefined }),
      ]);
      const own = session ? members.find((m) => m.userId === session.user.id) : undefined;
      setSubject({ orgRole: currentOrg.role, projectRole: own?.role });
      setDocuments(docs);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    setDocuments(null);
    setError(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug, kindFilter, stateFilter]);

  if (!projectSlug) return <LoadingState label="Cargando documentos…" />;

  const canCreate = subject ? can(subject, 'edit_document') : false;

  return (
    <div>
      <div className={styles.contentHeader}>
        <h1 className={formStyles.title}>Documentos</h1>
        {canCreate && <NewDocumentForm orgSlug={orgSlug} projectSlug={projectSlug} onCreated={() => void reload()} />}
      </div>
      <div className={formStyles.field}>
        <label htmlFor="documents-filter-kind">Tipo</label>
        <select id="documents-filter-kind" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as DocumentKind | '')}>
          <option value="">{KIND_LABEL}</option>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className={formStyles.field}>
        <label htmlFor="documents-filter-state">Estado</label>
        <select id="documents-filter-state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as DocumentWorkflowState | '')}>
          <option value="">{STATE_LABEL}</option>
          {DOCUMENT_WORKFLOW_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <FormError message={error} />
      {!documents && !error && <LoadingState label="Cargando documentos…" />}
      {documents && documents.length === 0 && <p className={formStyles.hint}>No hay documentos que coincidan con el filtro.</p>}
      {documents && documents.length > 0 && (
        <div className={formStyles.tableWrap}>
          <table className={formStyles.table}>
            <thead>
              <tr>
                <th>Id</th>
                <th>Tipo</th>
                <th>Título</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <Link className={formStyles.link} to={`/o/${orgSlug}/p/${projectSlug}/documents/${doc.docId}`}>
                      {doc.docId}
                    </Link>
                  </td>
                  <td>{doc.kind}</td>
                  <td>{doc.title}</td>
                  <td>{doc.workflowState}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
