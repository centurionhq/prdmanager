/**
 * Pure(ish) helpers for Enter-splits, Backspace-merges and pasted plain text (WO-310). These only
 * touch the DOM to read/extract a caret-bounded fragment; every block-model decision (new id, new
 * type, escaping) lives here so EditorColumn stays a thin wiring layer.
 */
import type { BlockType, DocumentBlock } from '../../data';
import { escapePlainText, generateBlockId, htmlToInline } from './markdown';

export interface SplitFields {
  readonly beforeHtml: string;
  readonly afterHtml: string;
}

/** Splits `root`'s content at the caret described by `range` into "before" and "after" HTML. */
export function splitFieldAtCaret(root: HTMLElement, range: Range): SplitFields {
  if (!root.lastChild) return { beforeHtml: '', afterHtml: '' };

  const caret = range.cloneRange();
  caret.collapse(true);
  const afterRange = document.createRange();
  afterRange.setStart(caret.startContainer, caret.startOffset);
  afterRange.setEndAfter(root.lastChild);
  const afterFragment = afterRange.extractContents();

  const beforeHtml = root.innerHTML;
  const afterContainer = document.createElement('div');
  afterContainer.appendChild(afterFragment);
  return { beforeHtml, afterHtml: afterContainer.innerHTML };
}

const HEADING_TYPES = new Set<BlockType>(['h1', 'h2', 'h3']);

/** The type a block created below `type` should have: same type, except a heading becomes `p`. */
export function typeAfterSplit(type: BlockType): BlockType {
  return HEADING_TYPES.has(type) ? 'p' : type;
}

/** The two blocks that replace `target` once Enter splits it at the caret. */
export function splitBlock(
  target: DocumentBlock,
  fields: SplitFields,
  author: string,
): { readonly updated: DocumentBlock; readonly created: DocumentBlock } {
  const type = typeAfterSplit(target.type);
  return {
    updated: { ...target, text: htmlToInline(fields.beforeHtml) },
    created: {
      id: generateBlockId(),
      type,
      text: htmlToInline(fields.afterHtml),
      author,
      checked: type === 'task' ? false : undefined,
    },
  };
}

/** `previous` absorbing `target`'s text, e.g. for Backspace at the start of a block. */
export function mergeIntoPrevious(previous: DocumentBlock, target: DocumentBlock): DocumentBlock {
  return { ...previous, text: `${previous.text}${target.text}` };
}

/** The block(s) that replace `target` once `clipboardText` is pasted at the caret. */
export function blocksForPaste(
  target: DocumentBlock,
  fields: SplitFields,
  clipboardText: string,
  author: string,
): readonly DocumentBlock[] {
  const lines = clipboardText.split('\n');
  const beforeText = htmlToInline(fields.beforeHtml);
  const afterText = htmlToInline(fields.afterHtml);

  if (lines.length === 1) {
    return [{ ...target, text: `${beforeText}${escapePlainText(lines[0] ?? '')}${afterText}` }];
  }

  const firstLine = escapePlainText(lines[0] ?? '');
  const lastLine = escapePlainText(lines[lines.length - 1] ?? '');
  const middleLines = lines.slice(1, -1).map(escapePlainText);
  const lastType = typeAfterSplit(target.type);

  const updated: DocumentBlock = { ...target, text: `${beforeText}${firstLine}` };
  const middleBlocks: DocumentBlock[] = middleLines.map((text) => ({ id: generateBlockId(), type: 'p', text, author }));
  const last: DocumentBlock = {
    id: generateBlockId(),
    type: lastType,
    text: `${lastLine}${afterText}`,
    author,
    checked: lastType === 'task' ? false : undefined,
  };
  return [updated, ...middleBlocks, last];
}
