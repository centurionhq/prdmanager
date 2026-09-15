/**
 * Keeps the block model and the Markdown-tab draft in sync as the editor mode switches: entering
 * Markdown seeds the draft from the blocks, and leaving it folds the (possibly edited) draft back
 * into the block model via `reconcileBlocks`.
 */
import { useState } from 'react';
import type { DocumentBlock } from '../../data';
import { reconcileBlocks } from './blockReconciliation';
import { CURRENT_USER_ID } from './documentEditorConstants';
import { parseMarkdown, serializeBlocks } from './markdown';

export type EditorMode = 'preview' | 'markdown';

export interface UseEditorModeSyncOptions {
  readonly blocks: readonly DocumentBlock[];
  readonly setBlocks: (next: readonly DocumentBlock[]) => void;
}

export interface UseEditorModeSyncResult {
  readonly editorMode: EditorMode;
  readonly setEditorMode: (mode: EditorMode) => void;
  readonly markdownDraft: string;
  readonly setMarkdownDraft: (draft: string) => void;
  readonly markdownLineBlockIds: readonly (string | undefined)[];
  /** `blocks` folded with any pending Markdown-tab edit, without touching state (pure read). */
  readonly effectiveBlocks: () => readonly DocumentBlock[];
}

export function useEditorModeSync({ blocks, setBlocks }: UseEditorModeSyncOptions): UseEditorModeSyncResult {
  const [editorMode, setEditorModeState] = useState<EditorMode>('preview');
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [markdownLineBlockIds, setMarkdownLineBlockIds] = useState<readonly (string | undefined)[]>([]);

  function effectiveBlocks(): readonly DocumentBlock[] {
    if (editorMode !== 'markdown') return blocks;
    return reconcileBlocks(blocks, parseMarkdown(markdownDraft), CURRENT_USER_ID);
  }

  function setEditorMode(next: EditorMode): void {
    if (next === editorMode) return;
    if (next === 'markdown') {
      const serialized = serializeBlocks(blocks);
      setMarkdownDraft(serialized.source);
      setMarkdownLineBlockIds(serialized.lineBlockIds);
    } else {
      setBlocks(effectiveBlocks());
    }
    setEditorModeState(next);
  }

  return { editorMode, setEditorMode, markdownDraft, setMarkdownDraft, markdownLineBlockIds, effectiveBlocks };
}
