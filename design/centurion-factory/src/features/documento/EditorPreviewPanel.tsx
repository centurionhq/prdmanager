/** The "Vista previa" tab panel: the formatting Toolbar plus the WYSIWYG PreviewEditor. */
import type { ReactElement } from 'react';
import type { DocumentBlock } from '../../data';
import { PreviewEditor } from './PreviewEditor';
import { Toolbar } from './Toolbar';
import type { UseBlockFieldEditingResult } from './useBlockFieldEditing';
import type { UseInlineFormattingResult } from './useInlineFormatting';

export interface EditorPreviewPanelProps {
  readonly blocks: readonly DocumentBlock[];
  readonly field: UseBlockFieldEditingResult;
  readonly inline: UseInlineFormattingResult;
}

export function EditorPreviewPanel({ blocks, field, inline }: EditorPreviewPanelProps): ReactElement {
  return (
    <>
      <Toolbar
        blockType={field.focusedBlock?.type}
        activeFormats={inline.activeFormats}
        onSetBlockType={field.handleSetBlockType}
        onFormatSelection={inline.handleFormatSelection}
        onRequestLink={inline.handleRequestLink}
        onInsertLink={inline.handleInsertLink}
        onCancelLink={inline.handleCancelLink}
        linkEnabled={field.hasBlockFocus}
      />
      <PreviewEditor
        blocks={blocks}
        onFocusBlock={field.handleFocusBlock}
        onBlurBlock={() => field.setHasBlockFocus(false)}
        onChangeText={(id, text) => field.updateBlock(id, { text })}
        onToggleChecked={(id) => field.updateBlock(id, { checked: !blocks.find((block) => block.id === id)?.checked })}
        onFormatShortcut={inline.handleFormatSelection}
        onSelectionChange={inline.refreshActiveFormats}
        onSplitBlock={field.handleSplitBlock}
        onMergeWithPrevious={field.handleMergeWithPrevious}
        onPasteText={field.handlePasteText}
        registerField={(id, element) => {
          if (element) field.fieldsRef.current.set(id, element);
          else field.fieldsRef.current.delete(id);
        }}
      />
    </>
  );
}
