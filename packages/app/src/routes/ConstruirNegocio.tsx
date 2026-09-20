/**
 * The business path of the Planta's entry band (SDD-053/PRD-033 R2),
 * `/o/:orgSlug/p/:projectSlug/construir/negocio`: pick the record the need comes from, give it a title, and land
 * in the document, where the guide (`./documento/BusinessCaseGuide.tsx`) walks through the four sections.
 *
 * The origin is asked for *here*, and it is not optional: `checkBusinessCase` refuses to publish a BC that
 * nothing justifies, and publishing is the only thing that leaves the initiative approved and lets the product
 * path start. Creating one without an origin would be handing someone a document they can never finish -- the
 * exact failure PRD-033 exists to remove. Nobody picks a kind or types a sigla: the records are titles of things
 * that already happened.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { can, documentTitleSchema, type DocumentSummary } from '@prdm/contracts';
import { createDocument, listDocuments } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiMutation } from '../api/use-api-mutation.js';
import { useApiQuery } from '../api/use-api-query.js';
import { Button, ErrorState, IdTag, OptionPlates, PageHeader, Skeleton, type OptionPlate } from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import styles from './ConstruirNegocio.module.css';
import { useProjectShellContext } from './ProjectShell.js';

/** What a business case may hang from: a Feedback or an Artifact (`hasJustification`), and only once published
 * -- the publish check resolves links against published documents, so a draft one would not count. */
const ORIGIN_KINDS: ReadonlySet<string> = new Set(['FB', 'ART']);

const ORIGIN_DESCRIPTION: Readonly<Record<string, string>> = {
  FB: 'Algo que alguien dijo y quedó registrado en la bandeja de entrada.',
  ART: 'Un artefacto con contexto: una nota, una llamada, un documento.',
};

function originRecords(documents: readonly DocumentSummary[]): DocumentSummary[] {
  return documents.filter((doc) => ORIGIN_KINDS.has(doc.kind)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function toPlate(record: DocumentSummary): OptionPlate {
  return { value: record.docId, title: record.title, description: ORIGIN_DESCRIPTION[record.kind] ?? '', meta: <IdTag id={record.docId} /> };
}

interface ChooseOriginProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly records: readonly DocumentSummary[];
}

function ChooseOrigin({ orgSlug, projectSlug, records }: ChooseOriginProps): ReactElement {
  const navigate = useNavigate();
  const [originId, setOriginId] = useState<string>(() => records[0]?.docId ?? '');
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useApiMutation(
    (input: { title: string; originId: string }) => createDocument(orgSlug, projectSlug, { kind: 'BC', title: input.title, fields: { justified_by: [input.originId] } }),
    { invalidate: [`documents:${orgSlug}:${projectSlug}`] },
  );

  const trimmedTitle = title.trim();
  const titleValid = documentTitleSchema.safeParse(trimmedTitle).success;
  const busy = mutation.status === 'cargando';

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    if (!titleValid) return;

    try {
      const document = await mutation.mutate({ title: trimmedTitle, originId });
      void navigate(`${projectBasePath(orgSlug, projectSlug)}/documents/${document.docId}`);
    } catch {
      // `mutation.error` carries it; the form stays as it was so trying again is one click.
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <OptionPlates label="Elegí de dónde sale" mode="radio" layout="stack" marker options={records.map(toPlate)} value={originId} onChange={setOriginId} />

      <div className={styles.field}>
        <label htmlFor="negocio-titulo" className={styles.label}>
          ¿Qué querés proponer?
        </label>
        <input id="negocio-titulo" className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={touched && !titleValid} aria-describedby="negocio-titulo-ayuda" autoComplete="off" />
        <span id="negocio-titulo-ayuda" className={styles.hint}>
          Un título en una línea. Después lo podés cambiar.
        </span>
        {touched && !titleValid ? (
          <p role="alert" className={styles.error}>
            Escribí un título para tu caso de negocio.
          </p>
        ) : null}
      </div>

      {mutation.status === 'error' ? (
        <p role="alert" className={styles.error}>
          {errorMessage(mutation.error)}
        </p>
      ) : null}

      <div className={styles.submit}>
        <Button type="submit" variant="primary" disabled={busy}>
          Empezar el caso de negocio
        </Button>
        <span className={styles.hint}>
          Te deja en el documento, ya colgado de <IdTag id={originId} />.
        </span>
      </div>

      <p className={styles.aside}>
        Cuando lo publiques, esta iniciativa queda aprobada y recién ahí alguien puede escribir los requisitos colgados de ella.
      </p>
    </form>
  );
}

export function ConstruirNegocio(): ReactElement {
  const { orgSlug, projectSlug, subject } = useProjectShellContext();
  useDocumentTitle('Empezar un caso de negocio');
  const base = projectBasePath(orgSlug, projectSlug);
  const canCreate = can(subject, 'edit_document');

  const documentsQuery = useApiQuery(
    `documents:${orgSlug}:${projectSlug}:published`,
    () => listDocuments(orgSlug, projectSlug, { workflowState: 'published' }),
    [orgSlug, projectSlug],
    () => false,
  );
  const records = documentsQuery.data ? originRecords(documentsQuery.data) : [];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <>
            <Link to={base}>Planta</Link> / Tu caso de negocio
          </>
        }
        title="¿De dónde sale esta necesidad?"
        subtitle="Un caso de negocio explica por qué conviene hacer algo. Elegí de qué quedó registrado sale, ponele un título, y lo escribís guiado en el documento."
      />

      {!canCreate ? <p className={styles.notice}>No tenés permiso para crear documentos en este proyecto. Pedile a alguien del equipo con permiso de edición que arranque el caso de negocio.</p> : null}

      {canCreate && documentsQuery.status === 'cargando' ? <Skeleton rows={3} /> : null}

      {canCreate && documentsQuery.status === 'error' ? <ErrorState title="No pudimos cargar los registros" body={errorMessage(documentsQuery.error)} onRetry={documentsQuery.retry} /> : null}

      {canCreate && documentsQuery.data && records.length > 0 ? <ChooseOrigin orgSlug={orgSlug} projectSlug={projectSlug} records={records} /> : null}
    </div>
  );
}
