/**
 * The product path of the Planta's entry band (SDD-052/PRD-033 R3), `/o/:orgSlug/p/:projectSlug/construir/producto`.
 * Approved on the canvas (`ConstruirProducto.dc.html`): pick the initiative the requirements come from, give the
 * document a title, and land on it already chained -- there is no way through this screen that creates a PRD
 * without an initiative.
 *
 * The initiatives are the *approved* business cases on the line (`getLineBoard`, the one source that carries the
 * BC's status and what already hangs from it). Whether a PRD may actually be published against one is still
 * `checkFeatureBusinessCase`'s rule, run at publish and in the editor; nothing here re-implements it.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { can, documentTitleSchema, type FeatureLineDto } from '@prdm/contracts';
import { createDocument, getLineBoard } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiMutation } from '../api/use-api-mutation.js';
import { useApiQuery } from '../api/use-api-query.js';
import { Button, ErrorState, IdTag, OptionPlates, PageHeader, Skeleton, type OptionPlate } from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import styles from './ConstruirProducto.module.css';
import { useProjectShellContext } from './ProjectShell.js';

function approvedInitiatives(features: readonly FeatureLineDto[]): FeatureLineDto[] {
  return features.filter((feature) => feature.kind === 'BC' && feature.status === 'approved');
}

function hangingLabel(count: number): string {
  if (count === 0) return 'Todavía sin documentos de requisitos';
  return count === 1 ? '1 documento de requisitos ya colgado' : `${count} documentos de requisitos ya colgados`;
}

function toPlate(initiative: FeatureLineDto): OptionPlate {
  return {
    value: initiative.id,
    title: initiative.title,
    description: hangingLabel(initiative.children.length),
    meta: <IdTag id={initiative.id} />,
  };
}

interface ChooseInitiativeProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly initiatives: readonly FeatureLineDto[];
}

function ChooseInitiative({ orgSlug, projectSlug, initiatives }: ChooseInitiativeProps): ReactElement {
  const navigate = useNavigate();
  const [initiativeId, setInitiativeId] = useState<string>(() => initiatives[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useApiMutation((input: { title: string; initiativeId: string }) => createDocument(orgSlug, projectSlug, { kind: 'PRD', title: input.title, fields: { justified_by: [input.initiativeId] } }), {
    invalidate: [`documents:${orgSlug}:${projectSlug}`],
  });

  const trimmedTitle = title.trim();
  const titleValid = documentTitleSchema.safeParse(trimmedTitle).success;
  const busy = mutation.status === 'cargando';

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    if (!titleValid) return;

    try {
      const document = await mutation.mutate({ title: trimmedTitle, initiativeId });
      void navigate(`${projectBasePath(orgSlug, projectSlug)}/documents/${document.docId}`);
    } catch {
      // `mutation.error` carries it; the form stays exactly as it was so trying again is one click.
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <OptionPlates label="Elegí la iniciativa" mode="radio" layout="stack" marker options={initiatives.map(toPlate)} value={initiativeId} onChange={setInitiativeId} />

      <div className={styles.field}>
        <label htmlFor="construir-titulo" className={styles.label}>
          ¿Qué querés definir?
        </label>
        <input id="construir-titulo" className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={touched && !titleValid} aria-describedby="construir-titulo-ayuda" autoComplete="off" />
        <span id="construir-titulo-ayuda" className={styles.hint}>
          Un título en una línea. Después lo podés cambiar.
        </span>
        {touched && !titleValid ? (
          <p role="alert" className={styles.error}>
            Escribí un título para los requisitos.
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
          Escribir los requisitos
        </Button>
        <span className={styles.hint}>
          Te deja en el documento, ya colgado de <IdTag id={initiativeId} />.
        </span>
      </div>
    </form>
  );
}

export function ConstruirProducto(): ReactElement {
  const { orgSlug, projectSlug, subject } = useProjectShellContext();
  useDocumentTitle('Escribir requisitos');
  const base = projectBasePath(orgSlug, projectSlug);
  const canCreate = can(subject, 'edit_document');

  const lineBoardQuery = useApiQuery(`line-board:${orgSlug}:${projectSlug}`, () => getLineBoard(orgSlug, projectSlug), [orgSlug, projectSlug], () => false);
  const initiatives = lineBoardQuery.data ? approvedInitiatives(lineBoardQuery.data.features) : [];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <>
            <Link to={base}>Planta</Link> / Escribir requisitos
          </>
        }
        title="¿De qué iniciativa salen estos requisitos?"
        subtitle="Todo lo que se construye cuelga de una iniciativa aprobada. Elegí la que corresponde y el documento queda enganchado solo."
      />

      {!canCreate ? <p className={styles.notice}>No tenés permiso para crear documentos en este proyecto. Pedile a alguien del equipo con permiso de edición que arranque los requisitos.</p> : null}

      {canCreate && lineBoardQuery.status === 'cargando' ? <Skeleton rows={3} /> : null}

      {canCreate && lineBoardQuery.status === 'error' ? (
        <ErrorState title="No pudimos cargar las iniciativas" body={errorMessage(lineBoardQuery.error)} onRetry={lineBoardQuery.retry} />
      ) : null}

      {canCreate && lineBoardQuery.data && initiatives.length > 0 ? <ChooseInitiative orgSlug={orgSlug} projectSlug={projectSlug} initiatives={initiatives} /> : null}
    </div>
  );
}
