/**
 * Inline formatting (Negrita/Cursiva/Tachado) and Enlace link handling for the block-model editor.
 * Extracted from EditorColumn (WO-319) so that component stays a thin wiring layer; the two
 * concerns are implemented in `useActiveFormats` and `useLinkPopover` and composed here.
 */
import type { MutableRefObject } from 'react';
import { useActiveFormats, type UseActiveFormatsResult } from './useActiveFormats';
import { useLinkPopover, type UseLinkPopoverResult } from './useLinkPopover';

export interface UseInlineFormattingOptions {
  readonly fieldsRef: MutableRefObject<Map<string, HTMLDivElement>>;
  readonly focusedBlockId: string | undefined;
  readonly onSyncBlockText: (blockId: string, text: string) => void;
}

export type UseInlineFormattingResult = UseActiveFormatsResult & UseLinkPopoverResult;

/** Selection-aware inline formatting and the Enlace popover's captured-Range workflow. */
export function useInlineFormatting({ fieldsRef, focusedBlockId, onSyncBlockText }: UseInlineFormattingOptions): UseInlineFormattingResult {
  const format = useActiveFormats({ fieldsRef, focusedBlockId, onSyncBlockText });
  const link = useLinkPopover({ fieldsRef, focusedBlockId, onSyncBlockText, onAfterCancel: format.refreshActiveFormats });

  return { ...format, ...link };
}
