/**
 * Documento screen: breadcrumb, title, status, meta line, the "Ver como" role simulator and the
 * Guardar/workflow actions over a three-column layout (frontmatter, editor, side panel) on
 * desktop, and a tabbed layout on mobile. WO-287 laid out the shell; WO-288 wires the role
 * selector and the workflow transitions; WO-300 upgrades the editor.
 */
import type { ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ErrorState, PageHeader, StatusBadge, useToast } from '../../components';
import { validationIssuesForDocument } from '../../data';
import styles from './DocumentoPage.module.css';
import { EditorColumn } from './EditorColumn';
import { FrontmatterForm } from './FrontmatterForm';
import { editingAsLabel } from './labels';
import { MobileTabs } from './MobileTabs';
import { RoleSelect } from './RoleSelect';
import { SidePanel } from './SidePanel';
import { useDocumentEditor, type WorkflowTransition } from './useDocumentEditor';
import { useMediaQuery } from './useMediaQuery';
import { WorkflowActions } from './WorkflowActions';

const MOBILE_QUERY = '(max-width: 767px)';

function latestOf<T extends { readonly versionNo: number }>(versions: readonly T[]): T | undefined {
  return [...versions].sort((a, b) => b.versionNo - a.versionNo).at(0);
}

/**
 * The route renders `<DocumentoPage />` for every `/documentos/:id`, so without a key React keeps
 * reusing the same component instance across navigations and the previous document's local state
 * (frontmatter draft, editor mode, focused block…) leaks into the next one. Keying by `id` forces a
 * full remount instead.
 */
export function DocumentoPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  return <DocumentoPageForId key={id} id={id} />;
}

function DocumentoPageForId({ id }: { readonly id: string }): ReactElement {
  const navigate = useNavigate();
  const { show } = useToast();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const {
    document,
    workflowState,
    blocks,
    versions,
    proposals,
    metaLine,
    architectOf,
    role,
    setRole,
    save,
    transition,
    acceptProposal,
    rejectProposal,
    comments,
    addReply,
    resolveThread,
    restoreVersion,
    updateBlocks,
    editorMode,
    setEditorMode,
    markdownDraft,
    setMarkdownDraft,
  } = useDocumentEditor(id);

  if (!document || !workflowState) {
    return (
      <ErrorState
        title={`No encontramos el documento ${id}.`}
        body="Puede que se haya archivado o que el enlace esté roto."
        onRetry={() => navigate('/documentos')}
        retryLabel="Volver a Documentos"
      />
    );
  }

  const errorCount = validationIssuesForDocument(document.id).filter((issue) => issue.severity === 'error').length;

  function handleSave(): void {
    save();
    show('Guardado');
  }

  function handleTransition(kind: WorkflowTransition): void {
    show(transition(kind));
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <nav aria-label="Ruta" className={styles.breadcrumb}>
            <Link to="/documentos">Documentos</Link>
            <span aria-hidden="true">/</span>
            <span className="id">{document.id}</span>
          </nav>
        }
        title={document.title}
        subtitle={
          <span className={styles.meta}>
            <StatusBadge kind="workflow" status={workflowState} />
            <span className={styles.metaText}>{metaLine}</span>
          </span>
        }
        actions={
          isMobile ? undefined : (
            <div className={styles.desktopActions}>
              <RoleSelect role={role} onChange={setRole} />
              <span className={styles.editingAs}>Editás como {editingAsLabel(role)}</span>
              <Button type="button" variant="secondary" onClick={handleSave}>
                Guardar
              </Button>
              <WorkflowActions workflowState={workflowState} role={role} errorCount={errorCount} onTransition={handleTransition} />
            </div>
          )
        }
      />

      {isMobile ? (
        <div className={styles.mobileLayout}>
          <MobileTabs
            document={document}
            blocks={blocks}
            proposals={proposals}
            onAcceptProposal={acceptProposal}
            onRejectProposal={rejectProposal}
            comments={comments}
            onReply={addReply}
            onResolveThread={resolveThread}
            versions={versions}
            onRestoreVersion={restoreVersion}
            onBlocksChange={updateBlocks}
            saveStatus={metaLine}
            editorMode={editorMode}
            onEditorModeChange={setEditorMode}
            markdownDraft={markdownDraft}
            onMarkdownDraftChange={setMarkdownDraft}
          />
          <div className={styles.mobileActionBar}>
            <Button type="button" variant="secondary" onClick={handleSave}>
              Guardar
            </Button>
            <WorkflowActions workflowState={workflowState} role={role} errorCount={errorCount} onTransition={handleTransition} />
          </div>
        </div>
      ) : (
        <div className={styles.desktopLayout}>
          <FrontmatterForm document={document} workflowState={workflowState} architectOf={architectOf} latestVersion={latestOf(versions)} />
          <EditorColumn
            blocks={blocks}
            onBlocksChange={updateBlocks}
            saveStatus={metaLine}
            mode={editorMode}
            onModeChange={setEditorMode}
            markdownDraft={markdownDraft}
            onMarkdownDraftChange={setMarkdownDraft}
          />
          <SidePanel
            document={document}
            blocks={blocks}
            proposals={proposals}
            onAcceptProposal={acceptProposal}
            onRejectProposal={rejectProposal}
            comments={comments}
            onReply={addReply}
            onResolveThread={resolveThread}
            versions={versions}
            onRestoreVersion={restoreVersion}
          />
        </div>
      )}
    </div>
  );
}
