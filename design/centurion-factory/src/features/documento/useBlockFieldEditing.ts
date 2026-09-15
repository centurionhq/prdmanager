/**
 * Block-level editing for the preview column: which field has focus, splitting/merging blocks on
 * Enter/Backspace, and pasting plain text into one or more blocks. Extracted from EditorColumn
 * (WO-319); implemented as `useBlockFocus` (focus/caret) plus `useBlockStructureEditing`
 * (split/merge/paste), composed here under EditorColumn's original hook name.
 */
import type { DocumentBlock } from '../../data';
import { useBlockFocus, type UseBlockFocusResult } from './useBlockFocus';
import { useBlockStructureEditing, type UseBlockStructureEditingResult } from './useBlockStructureEditing';

export interface UseBlockFieldEditingOptions {
  readonly blocks: readonly DocumentBlock[];
  readonly onBlocksChange: (next: readonly DocumentBlock[]) => void;
}

export type UseBlockFieldEditingResult = UseBlockFocusResult & UseBlockStructureEditingResult;

export function useBlockFieldEditing({ blocks, onBlocksChange }: UseBlockFieldEditingOptions): UseBlockFieldEditingResult {
  const focus = useBlockFocus({ blocks });
  const structure = useBlockStructureEditing({
    blocks,
    onBlocksChange,
    fieldsRef: focus.fieldsRef,
    focusedBlockId: focus.focusedBlockId,
    focusedBlock: focus.focusedBlock,
    requestFocus: focus.requestFocus,
  });

  return { ...focus, ...structure };
}
