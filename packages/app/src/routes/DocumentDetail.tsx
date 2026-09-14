/**
 * `/o/:orgSlug/p/:projectSlug/documents/:docId` (SDD-007 "Documentos y flujo", WO-141): a read-only
 * placeholder view (a real collaborative editor is SDD-008's job) showing the document's current
 * frontmatter/body as plain text, with "Solicitar revisión"/"Publicar"/"Archivar" gated per role and
 * current `workflowState` — matching the permission matrix and state machine the server enforces
 * (`packages/server/src/api/documents.ts`/`documents-publish.ts`).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { can, type DocumentDetail as DocumentDetailDto, type PermissionSubject } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { archiveDocument, generateWorkOrders, getDocument, getProject, getSession, listProjectMembers, publishDocument, requestDocumentReview } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { CloseFeatureAction } from './CloseFeatureAction.js';
import { CollabEditor } from '../components/CollabEditor.js';
import { CommentsPanel } from '../components/CommentsPanel.js';
import { VersionsPanel } from '../components/VersionsPanel.js';
import { FrontmatterForm } from '../components/FrontmatterForm.js';
import { CollabDocumentProvider } from '../collab/collab-document-context.js';
import { formatCollabDocumentName } from '../collab/document-name.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';

const FEATURE_KINDS = new Set(['MRD', 'PRD', 'FR']);

type WorkOrdersOutcome = { generated: boolean; created: number; error?: string };

export function DocumentDetail(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const { projectSlug, docId } = useParams<{ projectSlug: string; docId: string }>();
  const [doc, setDoc] = useState<DocumentDetailDto | null>(null);
  const [subject, setSubject] = useState<PermissionSubject | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrdersOutcome | undefined>(undefined);
  useDocumentTitle(doc ? doc.docId : 'Documento');

  async function reload(): Promise<void> {
    if (!projectSlug || !docId) return;
    try {
      const [session, members, fetchedDoc, project] = await Promise.all([
        getSession(),
        listProjectMembers(orgSlug, projectSlug),
        getDocument(orgSlug, projectSlug, docId),
        getProject(orgSlug, projectSlug),
      ]);
      const own = session ? members.find((m) => m.userId === session.user.id) : undefined;
      setSubject({ orgRole: currentOrg.role, projectRole: own?.role });
      setDoc(fetchedDoc);
      setProjectId(project.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    setDoc(null);
    setError(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug, docId]);

  if (error) return <FormError message={error} />;
  if (!doc || !subject || !projectSlug || !docId) return <LoadingState label="Cargando documento…" />;

  const project = projectSlug;
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

  async function handlePublish(): Promise<void> {
    if (!latestVersion) return;
    setActionError(null);
    setBusy(true);
    try {
      const result = await publishDocument(orgSlug, project, id, { versionId: latestVersion.id, contentHash: latestVersion.contentHash });
      setWorkOrders(result.workOrders);
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
  const isApprovedFeature = FEATURE_KINDS.has(doc.kind) && doc.workflowState === 'published' && latestVersion?.frontmatter.status === 'approved';
  const canCloseFeature = isApprovedFeature && can(subject, 'close_feature');

  return (
    <div>
      <p>
        <Link className={formStyles.link} to={`/o/${orgSlug}/p/${projectSlug}/documents`}>
          ← Documentos
        </Link>
      </p>
      <h1 className={formStyles.title}>{doc.title}</h1>
      <p className={formStyles.subtitle}>
        {doc.docId} · {doc.kind} · {doc.workflowState}
      </p>

      <FormError message={actionError} />

      <div className={formStyles.actions}>
        {canRequestReview && (
          <button type="button" className={formStyles.primaryButton} disabled={busy} onClick={() => void handleRequestReview()}>
            Solicitar revisión
          </button>
        )}
        {canPublish && (
          <button type="button" className={formStyles.primaryButton} disabled={busy} onClick={() => void handlePublish()}>
            Publicar
          </button>
        )}
        {canArchive && (
          <button type="button" className={formStyles.secondaryButton} disabled={busy} onClick={() => void handleArchive()}>
            Archivar
          </button>
        )}
        {canCloseFeature && <CloseFeatureAction orgSlug={orgSlug} projectSlug={project} docId={id} onClosed={() => void reload()} />}
      </div>

      {isBlueprint && doc.workflowState === 'published' && workOrders && !workOrders.generated && (
        <div role="alert" className={formStyles.error}>
          <p>No se pudieron generar los work orders: {workOrders.error}</p>
          <button type="button" className={formStyles.secondaryButton} disabled={busy} onClick={() => void handleRetryWorkOrders()}>
            Reintentar generación de work orders
          </button>
        </div>
      )}
      {isBlueprint && doc.workflowState === 'published' && workOrders?.generated && (
        <p className={formStyles.success}>Work orders generados: {workOrders.created}</p>
      )}

      {doc.origin === 'collab' && projectId ? (
        <CollabDocumentProvider documentName={formatCollabDocumentName(projectId, doc.id)} orgSlug={orgSlug} projectSlug={project} docId={doc.docId}>
          <FrontmatterForm kind={doc.kind} />
          <CollabEditor />
          <CommentsPanel subject={subject} />
          <VersionsPanel subject={subject} />
        </CollabDocumentProvider>
      ) : (
        <pre className={formStyles.card}>{content || '(sin contenido)'}</pre>
      )}
    </div>
  );
}
