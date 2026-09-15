/**
 * Editor column: preview-first tabs ("Vista previa" default, "Markdown") over the block model.
 * Vista previa renders real WYSIWYG formatting (bold/italic/strikethrough/links); the block model
 * is always the source of truth, and the Markdown tab re-parses into it on switching back.
 *
 * This component is a thin wiring layer: block-structure editing (split/merge/paste/focus) lives
 * in `useBlockFieldEditing`, and inline formatting/link handling lives in `useInlineFormatting`.
 */
import type { ReactElement } from 'react';
import type { DocumentBlock } from '../../data';
import { Tabs, type TabDef, type TabsClassNames } from '../../components';
import { EditorPreviewPanel } from './EditorPreviewPanel';
import styles from './EditorColumn.module.css';
import { MarkdownEditor } from './MarkdownEditor';
import { useBlockFieldEditing } from './useBlockFieldEditing';
import type { EditorMode } from './useDocumentEditor';
import { useInlineFormatting } from './useInlineFormatting';

export interface EditorColumnProps {
  readonly blocks: readonly DocumentBlock[];
  readonly onBlocksChange: (next: readonly DocumentBlock[]) => void;
  readonly saveStatus: string;
  readonly mode: EditorMode;
  readonly onModeChange: (mode: EditorMode) => void;
  readonly markdownDraft: string;
  readonly onMarkdownDraftChange: (draft: string) => void;
  readonly markdownLineBlockIds: readonly (string | undefined)[];
}

const TAB_CLASS_NAMES: TabsClassNames = {
  tablist: styles.tabBar,
  tab: (selected) => (selected ? styles.tabSelected : styles.tab) ?? '',
  panel: styles.tabPanel,
};

export function EditorColumn({
  blocks,
  onBlocksChange,
  saveStatus,
  mode,
  onModeChange,
  markdownDraft,
  onMarkdownDraftChange,
  markdownLineBlockIds,
}: EditorColumnProps): ReactElement {
  const field = useBlockFieldEditing({ blocks, onBlocksChange });
  const inline = useInlineFormatting({
    fieldsRef: field.fieldsRef,
    focusedBlockId: field.focusedBlockId,
    onSyncBlockText: (id, text) => field.updateBlock(id, { text }),
  });

  const tabs: readonly TabDef[] = [
    { id: 'preview', label: 'Vista previa', panel: <EditorPreviewPanel blocks={blocks} field={field} inline={inline} /> },
    {
      id: 'markdown',
      label: 'Markdown',
      panel: <MarkdownEditor value={markdownDraft} onChange={onMarkdownDraftChange} gutterBlocks={blocks} lineBlockIds={markdownLineBlockIds} />,
    },
  ];

  const footerLeft = mode === 'preview' ? `Vista previa · ${blocks.length} bloques` : `Markdown · ${markdownDraft.split('\n').length} líneas`;

  return (
    <div className={styles.editor}>
      <Tabs ariaLabel="Modo del editor" idPrefix="editor" activeId={mode} onChange={(id) => onModeChange(id as EditorMode)} tabs={tabs} classNames={TAB_CLASS_NAMES} />
      <div className={styles.footer}>
        <span className="num">{footerLeft}</span>
        <span>{saveStatus}</span>
      </div>
    </div>
  );
}
