/**
 * Documento screen (WO-287): breadcrumb, title, status, meta line and Guardar/Publicar actions
 * over a three-column layout (frontmatter, editor, side panel) on desktop, and a tabbed layout on
 * mobile. WO-288 wires the role selector and the workflow actions; WO-300 upgrades the editor.
 */
import type { ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ErrorState, PageHeader, StatusBadge, useToast } from '../../components';
import styles from './DocumentoPage.module.css';
import { EditorColumn } from './EditorColumn';
import { FrontmatterForm } from './FrontmatterForm';
import { MobileTabs } from './MobileTabs';
import { SidePanel } from './SidePanel';
import { useDocumentEditor } from './useDocumentEditor';

function latestOf<T extends { readonly versionNo: number }>(versions: readonly T[]): T | undefined {
  return [...versions].sort((a, b) => b.versionNo - a.versionNo).at(0);
}

export function DocumentoPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { show } = useToast();
  const { document, versions, metaLine, architectOf, save } = useDocumentEditor(id);

  if (!document) {
    return (
      <ErrorState
        title={`No encontramos el documento ${id}.`}
        body="Puede que se haya archivado o que el enlace esté roto."
        onRetry={() => navigate('/documentos')}
        retryLabel="Volver a Documentos"
      />
    );
  }

  function handleSave(): void {
    save();
    show('Guardado');
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
            <StatusBadge kind="workflow" status={document.workflowState} />
            <span className={styles.metaText}>{metaLine}</span>
          </span>
        }
        actions={
          <div className={styles.desktopActions}>
            <span className={styles.editingAs}>Editás como Admin de proyecto</span>
            <Button type="button" variant="secondary" onClick={handleSave}>
              Guardar
            </Button>
            <Button type="button" variant="primary">
              Publicar
            </Button>
          </div>
        }
      />

      <div className={styles.desktopLayout}>
        <FrontmatterForm document={document} architectOf={architectOf} latestVersion={latestOf(versions)} />
        <EditorColumn blocks={document.blocks} />
        <SidePanel document={document} />
      </div>

      <div className={styles.mobileLayout}>
        <MobileTabs document={document} blocks={document.blocks} />
        <div className={styles.mobileActionBar}>
          <Button type="button" variant="secondary" onClick={handleSave}>
            Guardar
          </Button>
          <Button type="button" variant="primary">
            Publicar
          </Button>
        </div>
      </div>
    </div>
  );
}
