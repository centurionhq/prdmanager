/**
 * Block-structure editing for the preview column: setting a block's type, and splitting/merging
 * blocks or pasting text across them on Enter/Backspace/paste. Extracted from EditorColumn
 * (WO-319); pairs with `useBlockFocus`, which owns the field refs and post-edit focus move.
 */
import type { MutableRefObject } from 'react';
import type { BlockType, DocumentBlock } from '../../data';
import { blocksForPaste, mergeIntoPrevious, splitBlock, splitFieldAtCaret } from './blockEditing';
import type { FocusPosition } from './useBlockFocus';
import { CURRENT_USER_ID } from './useDocumentEditor';

type FieldsRef = MutableRefObject<Map<string, HTMLDivElement>>;

/** The field's root element and the caret Range inside it, if any (shared by Enter/Backspace/paste). */
function fieldCaret(fieldsRef: FieldsRef, blockId: string): { readonly root: HTMLDivElement; readonly range: Range } | undefined {
  const root = fieldsRef.current.get(blockId);
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return undefined;
  return { root, range };
}

interface StructureEdit {
  readonly next: readonly DocumentBlock[];
  /** Which field to move focus/caret to, if the edit created or removed one. */
  readonly focus?: { readonly id: string; readonly position: FocusPosition };
}

/** Splits `blockId` at the caret into two blocks; the new one gets focus at its start. */
function computeSplit(blocks: readonly DocumentBlock[], blockId: string, fieldsRef: FieldsRef): StructureEdit | undefined {
  const target = blocks.find((block) => block.id === blockId);
  const caret = fieldCaret(fieldsRef, blockId);
  if (!target || !caret) return undefined;

  const fields = splitFieldAtCaret(caret.root, caret.range);
  const { updated, created } = splitBlock(target, fields, CURRENT_USER_ID);
  const index = blocks.findIndex((block) => block.id === blockId);
  const next = blocks.map((block) => (block.id === blockId ? updated : block));
  return { next: [...next.slice(0, index + 1), created, ...next.slice(index + 1)], focus: { id: created.id, position: 'start' } };
}

/** Merges `blockId` into the previous block; the previous block keeps focus at its end. */
function computeMerge(blocks: readonly DocumentBlock[], blockId: string): StructureEdit | undefined {
  const index = blocks.findIndex((block) => block.id === blockId);
  const target = blocks[index];
  const previous = index > 0 ? blocks[index - 1] : undefined;
  if (!target || !previous) return undefined;

  const merged = mergeIntoPrevious(previous, target);
  const next = blocks.filter((block) => block.id !== blockId).map((block) => (block.id === previous.id ? merged : block));
  return { next, focus: { id: previous.id, position: 'end' } };
}

/**
 * Replaces `blockId` with the blocks parsed from pasted `clipboardText`. The last created block
 * gets focus, unless the paste didn't create any new block (focus already sits on `blockId`).
 */
function computePaste(blocks: readonly DocumentBlock[], blockId: string, clipboardText: string, fieldsRef: FieldsRef): StructureEdit | undefined {
  const target = blocks.find((block) => block.id === blockId);
  const caret = fieldCaret(fieldsRef, blockId);
  if (!target || !caret) return undefined;

  const fields = splitFieldAtCaret(caret.root, caret.range);
  const replacement = blocksForPaste(target, fields, clipboardText, CURRENT_USER_ID);
  const index = blocks.findIndex((block) => block.id === blockId);
  const next = [...blocks.slice(0, index), ...replacement, ...blocks.slice(index + 1)];
  const lastCreated = replacement[replacement.length - 1];
  return { next, focus: lastCreated && lastCreated.id !== blockId ? { id: lastCreated.id, position: 'end' } : undefined };
}

export interface UseBlockStructureEditingOptions {
  readonly blocks: readonly DocumentBlock[];
  readonly onBlocksChange: (next: readonly DocumentBlock[]) => void;
  readonly fieldsRef: FieldsRef;
  readonly focusedBlockId: string | undefined;
  readonly focusedBlock: DocumentBlock | undefined;
  readonly requestFocus: (id: string, position: FocusPosition) => void;
}

export interface UseBlockStructureEditingResult {
  readonly updateBlock: (id: string, patch: Partial<DocumentBlock>) => void;
  readonly handleSetBlockType: (type: BlockType) => void;
  readonly handleSplitBlock: (blockId: string) => void;
  readonly handleMergeWithPrevious: (blockId: string) => void;
  readonly handlePasteText: (blockId: string, clipboardText: string) => void;
}

export function useBlockStructureEditing({
  blocks,
  onBlocksChange,
  fieldsRef,
  focusedBlockId,
  focusedBlock,
  requestFocus,
}: UseBlockStructureEditingOptions): UseBlockStructureEditingResult {
  function updateBlock(id: string, patch: Partial<DocumentBlock>): void {
    onBlocksChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function handleSetBlockType(type: BlockType): void {
    if (!focusedBlockId) return;
    updateBlock(focusedBlockId, { type, checked: type === 'task' ? (focusedBlock?.checked ?? false) : undefined });
  }

  function applyEdit(edit: StructureEdit | undefined): void {
    if (!edit) return;
    onBlocksChange(edit.next);
    if (edit.focus) requestFocus(edit.focus.id, edit.focus.position);
  }

  return {
    updateBlock,
    handleSetBlockType,
    handleSplitBlock: (blockId) => applyEdit(computeSplit(blocks, blockId, fieldsRef)),
    handleMergeWithPrevious: (blockId) => applyEdit(computeMerge(blocks, blockId)),
    handlePasteText: (blockId, clipboardText) => applyEdit(computePaste(blocks, blockId, clipboardText, fieldsRef)),
  };
}
