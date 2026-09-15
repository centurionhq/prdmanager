/** DocumentoPage's desktop layout: frontmatter, editor and side panel columns. */
import type { ReactElement } from 'react';
import type { ProjectDocument, WorkflowState } from '../../data';
import styles from './DocumentoPage.module.css';
import { EditorColumn } from './EditorColumn';
import { FrontmatterForm } from './FrontmatterForm';
import { SidePanel } from './SidePanel';
import type { UseDocumentEditorResult } from './useDocumentEditor';

function latestOf<T extends { readonly versionNo: number }>(versions: readonly T[]): T | undefined {
  return [...versions].sort((a, b) => b.versionNo - a.versionNo).at(0);
}

export interface DocumentoDesktopLayoutProps {
  readonly document: ProjectDocument;
  readonly workflowState: WorkflowState;
  readonly architectOf: string | undefined;
  readonly editor: UseDocumentEditorResult;
}

export function DocumentoDesktopLayout({ document, workflowState, architectOf, editor }: DocumentoDesktopLayoutProps): ReactElement {
  return (
    <div className={styles.desktopLayout}>
      <FrontmatterForm document={document} workflowState={workflowState} architectOf={architectOf} latestVersion={latestOf(editor.versions)} />
      <EditorColumn
        blocks={editor.blocks}
        onBlocksChange={editor.updateBlocks}
        saveStatus={editor.metaLine}
        mode={editor.editorMode}
        onModeChange={editor.setEditorMode}
        markdownDraft={editor.markdownDraft}
        onMarkdownDraftChange={editor.setMarkdownDraft}
        markdownLineBlockIds={editor.markdownLineBlockIds}
      />
      <SidePanel
        document={document}
        blocks={editor.blocks}
        proposals={editor.proposals}
        onAcceptProposal={editor.acceptProposal}
        onRejectProposal={editor.rejectProposal}
        comments={editor.comments}
        onReply={editor.addReply}
        onResolveThread={editor.resolveThread}
        versions={editor.versions}
        onRestoreVersion={editor.restoreVersion}
      />
    </div>
  );
}
