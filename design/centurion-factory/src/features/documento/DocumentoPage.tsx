/**
 * Documento screen: breadcrumb, title, status, meta line, the "Ver como" role simulator and the
 * Guardar/workflow actions over a three-column layout (frontmatter, editor, side panel) on
 * desktop, and a tabbed layout on mobile. WO-287 laid out the shell; WO-288 wires the role
 * selector and the workflow transitions; WO-300 upgrades the editor.
 */
import type { ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useToast } from '../../components';
import { validationIssuesForDocument } from '../../data';
import { DocumentoDesktopLayout } from './DocumentoDesktopLayout';
import { DocumentoHeader } from './DocumentoHeader';
import { DocumentoMobileLayout } from './DocumentoMobileLayout';
import { DocumentoNotFound } from './DocumentoNotFound';
import styles from './DocumentoPage.module.css';
import { useDocumentEditor, type WorkflowTransition } from './useDocumentEditor';
import { useMediaQuery } from './useMediaQuery';

const MOBILE_QUERY = '(max-width: 767px)';

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
  const editor = useDocumentEditor(id);
  const { document, workflowState } = editor;

  if (!document || !workflowState) {
    return <DocumentoNotFound id={id} onRetry={() => navigate('/documentos')} />;
  }

  const errorCount = validationIssuesForDocument(document.id).filter((issue) => issue.severity === 'error').length;

  function handleSave(): void {
    editor.save();
    show('Guardado');
  }

  function handleTransition(kind: WorkflowTransition): void {
    show(editor.transition(kind));
  }

  return (
    <div className={styles.page}>
      <DocumentoHeader
        document={document}
        workflowState={workflowState}
        metaLine={editor.metaLine}
        isMobile={isMobile}
        role={editor.role}
        onRoleChange={editor.setRole}
        errorCount={errorCount}
        onSave={handleSave}
        onTransition={handleTransition}
      />

      {isMobile ? (
        <DocumentoMobileLayout
          document={document}
          workflowState={workflowState}
          editor={editor}
          role={editor.role}
          errorCount={errorCount}
          onSave={handleSave}
          onTransition={handleTransition}
        />
      ) : (
        <DocumentoDesktopLayout document={document} workflowState={workflowState} architectOf={editor.architectOf} editor={editor} />
      )}
    </div>
  );
}
