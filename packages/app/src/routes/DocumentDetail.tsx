/**
 * `/o/:orgSlug/p/:projectSlug/documents/:docId` (SDD-013 §"Documentos", ports SDD-007/WO-141's screen):
 * the document's real header (id/título/estado), workflow actions gated by `can(subject, action)` against
 * the caller's *real* project role (`useProjectShellContext`, never a simulated selector), and — before a
 * `publish` actually lands — the `PublishReviewModal` review screen (WO-357, `DocumentoRevision.dc.html`).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { can, type DocumentDetail as DocumentDetailDto } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { archiveDocument, generateWorkOrders, getDocument, publishDocument, requestDocumentReview } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { CloseFeatureAction } from './CloseFeatureAction.js';
import { CollabEditor } from '../components/CollabEditor.js';
import { DocumentPanelTabs } from './DocumentPanelTabs.js';
import { FrontmatterForm } from '../components/FrontmatterForm.js';
import { MarkdownPreview } from '../components/MarkdownPreview.js';
import { Button, DocumentStateBanner, IdTag, PublishReviewModal, StatusBadge } from '../components/index.js';
import { CollabDocumentProvider } from '../collab/collab-document-context.js';
import { formatCollabDocumentName } from '../collab/document-name.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import formStyles from '../styles/forms.module.css';
import styles from './DocumentDetail.module.css';

const FEATURE_KINDS = new Set(['MRD', 'PRD', 'FR']);

type WorkOrdersOutcome = { generated: boolean; created: number; error?: string };

/**
 * WO-466 (SDD-034/PRD-015): the body of a non-`collab` document, with its leading `---` frontmatter
 * block removed. `publishedRaw`/`renderedMarkdown` are the whole file, so rendering them as-is printed
 * the YAML as if it were part of the text. Deliberately a small local split rather than `@prdm/core`'s
 * parser: `packages/app` doesn't depend on it, and the only thing needed here is "drop the front block".
 * A document with no frontmatter (or an unterminated one) is returned whole — never truncated.
 */
function documentBody(content: string): string {
  if (!content.startsWith('---')) return content;
  const afterOpen = content.indexOf('\n');
  if (afterOpen === -1) return content;
  const close = content.indexOf('\n---', afterOpen);
  if (close === -1) return content;
  const afterClose = content.indexOf('\n', close + 1);
  return afterClose === -1 ? '' : content.slice(afterClose + 1).replace(/^\n+/, '');
}

export function DocumentDetail(): ReactElement {
  const { orgSlug, projectSlug: project, project: projectOverview, subject } = useProjectShellContext();
  const { docId } = useParams<{ docId: string }>();
  const [doc, setDoc] = useState<DocumentDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrdersOutcome | undefined>(undefined);
  const [reviewOpen, setReviewOpen] = useState(false);
  useDocumentTitle(doc ? doc.docId : 'Documento');

  async function reload(): Promise<void> {
    if (!docId) return;
    try {
      setDoc(await getDocument(orgSlug, project, docId));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    setDoc(null);
    setError(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, project, docId]);

  if (error) return <FormError message={error} />;
  if (!doc || !docId) return <LoadingState label="Cargando documento…" />;

  const id = docId;
  const latestVersion = doc.latestVersion;

  async function handleRequestReview(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await requestDocumentReview(orgSlug, project, id);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openPublishReview(): void {
    setActionError(null);
    setReviewOpen(true);
  }

  async function handleConfirmPublish(): Promise<void> {
    if (!latestVersion) return;
    setActionError(null);
    setBusy(true);
    try {
      const result = await publishDocument(orgSlug, project, id, { versionId: latestVersion.id, contentHash: latestVersion.contentHash });
      setWorkOrders(result.workOrders);
      setReviewOpen(false);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await archiveDocument(orgSlug, project, id);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryWorkOrders(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      const outcome = await generateWorkOrders(orgSlug, project, id);
      setWorkOrders(outcome);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canRequestReview = doc.workflowState === 'draft' && can(subject, 'request_review');
  const canPublish = doc.workflowState === 'in_review' && can(subject, 'publish') && latestVersion !== null;
  const canArchive = doc.workflowState === 'published' && can(subject, 'archive');
  const isBlueprint = doc.kind === 'SDD' || doc.kind === 'ADR';
  const content = doc.publishedRaw ?? latestVersion?.renderedMarkdown ?? '';
  const body = documentBody(content);
  const isApprovedFeature = FEATURE_KINDS.has(doc.kind) && doc.workflowState === 'published' && latestVersion?.frontmatter.status === 'approved';
  const canCloseFeature = isApprovedFeature && can(subject, 'close_feature');

  return (
    <div className={styles.page}>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <Link className={formStyles.link} to={`/o/${orgSlug}/p/${project}/documents`}>
          Documentos
        </Link>
        <span aria-hidden="true">/</span>
        <IdTag id={doc.docId} />
      </nav>
      <div className={styles.headerRow}>
        <h1 className={formStyles.title}>{doc.title}</h1>
        <StatusBadge kind="workflow" status={doc.workflowState} />
      </div>
      <p className={formStyles.subtitle}>
        {doc.docId} · {doc.kind} · {doc.workflowState}
      </p>

      <FormError message={actionError} />

      <div className={formStyles.actions}>
        {/* A collab-origin document's workflow-action buttons live in ValidationPanel instead (WO-164),
            gated by the same can(subject, action) checks plus validation-aware disabling — never
            duplicated here too. */}
        {doc.origin !== 'collab' && (
          <>
            {canRequestReview && (
              <Button type="button" variant="primary" disabled={busy} onClick={() => void handleRequestReview()}>
                Solicitar revisión
              </Button>
            )}
            {canPublish && (
              <Button type="button" variant="primary" disabled={busy} onClick={openPublishReview}>
                Publicar
              </Button>
            )}
            {canArchive && (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void handleArchive()}>
                Archivar
              </Button>
            )}
          </>
        )}
        {canCloseFeature && <CloseFeatureAction orgSlug={orgSlug} projectSlug={project} docId={id} onClosed={() => void reload()} />}
      </div>

      {isBlueprint && doc.workflowState === 'published' && workOrders && !workOrders.generated && (
        <div role="alert" className={formStyles.error}>
          <p>No se pudieron generar los work orders: {workOrders.error}</p>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void handleRetryWorkOrders()}>
            Reintentar generación de work orders
          </Button>
        </div>
      )}
      {isBlueprint && doc.workflowState === 'published' && workOrders?.generated && (
        <p className={formStyles.success}>Work orders generados: {workOrders.created}</p>
      )}

      {latestVersion && (
        <PublishReviewModal
          open={reviewOpen}
          orgSlug={orgSlug}
          projectSlug={project}
          docId={id}
          kind={doc.kind}
          currentVersion={latestVersion}
          publishedVersionId={doc.publishedVersionId}
          validation={doc.lastValidation}
          busy={busy}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => void handleConfirmPublish()}
        />
      )}

      {doc.origin === 'collab' ? (
        <CollabDocumentProvider documentName={formatCollabDocumentName(projectOverview.id, doc.id)} orgSlug={orgSlug} projectSlug={project} docId={doc.docId}>
          <div className={styles.collabLayout}>
            <FrontmatterForm kind={doc.kind} />
            <CollabEditor subject={subject} archived={doc.workflowState === 'archived'} />
            <DocumentPanelTabs
              subject={subject}
              lastValidation={doc.lastValidation}
              canRequestReview={canRequestReview}
              canPublish={canPublish}
              canArchive={canArchive}
              busy={busy}
              onRequestReview={() => void handleRequestReview()}
              onPublish={openPublishReview}
              onArchive={() => void handleArchive()}
            />
          </div>
        </CollabDocumentProvider>
      ) : (
        <>
          <DocumentStateBanner variant={doc.workflowState === 'archived' ? 'archivado' : 'generado'} />
          <article className={styles.readingBody}>
            <MarkdownPreview body={body} />
          </article>
        </>
      )}
    </div>
  );
}
