/** DocumentoPage's mobile layout: the tab bar plus the fixed Guardar/workflow action bar. */
import type { ReactElement } from 'react';
import { Button } from '../../components';
import type { ProjectDocument, ProjectRole, WorkflowState } from '../../data';
import styles from './DocumentoPage.module.css';
import { MobileTabs } from './MobileTabs';
import type { UseDocumentEditorResult, WorkflowTransition } from './useDocumentEditor';
import { WorkflowActions } from './WorkflowActions';

export interface DocumentoMobileLayoutProps {
  readonly document: ProjectDocument;
  readonly workflowState: WorkflowState;
  readonly editor: UseDocumentEditorResult;
  readonly role: ProjectRole;
  readonly errorCount: number;
  readonly onSave: () => void;
  readonly onTransition: (kind: WorkflowTransition) => void;
}

export function DocumentoMobileLayout({
  document,
  workflowState,
  editor,
  role,
  errorCount,
  onSave,
  onTransition,
}: DocumentoMobileLayoutProps): ReactElement {
  return (
    <div className={styles.mobileLayout}>
      <MobileTabs
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
        onBlocksChange={editor.updateBlocks}
        saveStatus={editor.metaLine}
        editorMode={editor.editorMode}
        onEditorModeChange={editor.setEditorMode}
        markdownDraft={editor.markdownDraft}
        onMarkdownDraftChange={editor.setMarkdownDraft}
        markdownLineBlockIds={editor.markdownLineBlockIds}
      />
      <div className={styles.mobileActionBar}>
        <Button type="button" variant="secondary" onClick={onSave}>
          Guardar
        </Button>
        <WorkflowActions workflowState={workflowState} role={role} errorCount={errorCount} onTransition={onTransition} />
      </div>
    </div>
  );
}
