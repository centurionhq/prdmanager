/**
 * Maps a DOM caret position (as `window.getSelection()`/`Range` gives it — a node plus an offset into it)
 * to the `SourceBlock` + block-relative source offset `edit-ops.ts` expects, and back. Relies on
 * PreviewEditor.tsx's own rendering contract: every editable block's root DOM element carries
 * `data-block-from={block.from}`, and every `EditableRun` in `block.runs` renders as exactly one Text node,
 * in the same order — so the Nth Text node under a block element always corresponds to `block.runs[N]`.
 */
import type { SourceBlock } from './source-map.js';
import { runPrefixLength } from './run-text.js';

export interface BlockDomPosition {
  block: SourceBlock;
  offsetInBlock: number;
}

export interface DomPosition {
  node: Node;
  offset: number;
}

function collectTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function closestBlockElement(node: Node): Element | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return element?.closest('[data-block-from]') ?? null;
}

function findBlockByFrom(blocks: readonly SourceBlock[], from: number): SourceBlock | null {
  return blocks.find((block) => block.from === from) ?? null;
}

export function domPositionToBlockOffset(container: Node, offset: number, blocks: readonly SourceBlock[]): BlockDomPosition | null {
  const blockElement = closestBlockElement(container);
  if (!blockElement) return null;

  const blockFrom = Number(blockElement.getAttribute('data-block-from'));
  const block = findBlockByFrom(blocks, blockFrom);
  if (!block) return null;

  const textNodes = collectTextNodes(blockElement);
  if (textNodes.length === 0) return { block, offsetInBlock: 0 };

  const runs = block.runs ?? [];
  const containerTextNode = container.nodeType === Node.TEXT_NODE ? (container as Text) : null;
  const runIndex = containerTextNode ? textNodes.indexOf(containerTextNode) : -1;
  const run = runIndex === -1 ? null : (runs[runIndex] ?? null);

  if (!run || !containerTextNode) {
    return { block, offsetInBlock: block.to - block.contentFrom };
  }

  const clampedOffset = Math.max(0, Math.min(offset, containerTextNode.length));
  const absoluteOffset = run.from + runPrefixLength(run.kind) + clampedOffset;
  return { block, offsetInBlock: absoluteOffset - block.contentFrom };
}

export function blockOffsetToDomPosition(editorRoot: Element, block: SourceBlock, offsetInBlock: number): DomPosition | null {
  const blockElement =
    editorRoot.getAttribute('data-block-from') === String(block.from) ? editorRoot : editorRoot.querySelector(`[data-block-from="${block.from}"]`);
  if (!blockElement) return null;

  const textNodes = collectTextNodes(blockElement);
  if (textNodes.length === 0) return { node: blockElement, offset: 0 };

  const absoluteOffset = block.contentFrom + offsetInBlock;
  const runs = block.runs ?? [];
  const runIndex = runs.findIndex((run) => absoluteOffset >= run.from && absoluteOffset <= run.to);
  const targetIndex = runIndex === -1 ? textNodes.length - 1 : runIndex;
  const textNode = textNodes[targetIndex];
  if (!textNode) return null;

  const run = runs[targetIndex] ?? null;
  const withinRun = run ? absoluteOffset - run.from - runPrefixLength(run.kind) : absoluteOffset - block.contentFrom;
  return { node: textNode, offset: Math.max(0, Math.min(withinRun, textNode.length)) };
}
