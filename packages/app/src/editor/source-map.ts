import { GFM, parser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';

export type BlockKind =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet-item'
  | 'ordered-item'
  | 'task-item'
  | 'island';

export interface EditableRun {
  kind: 'text' | 'emphasis' | 'strong' | 'strikethrough' | 'link' | 'escape' | 'softbreak';
  from: number;
  to: number;
  href?: string;
}

export interface SourceBlock {
  kind: BlockKind;
  from: number;
  to: number;
  contentFrom: number;
  runs?: EditableRun[];
  taskChecked?: boolean;
  orderedNumber?: number;
}

// `Table` must be configured even though only task lists and strikethrough are ever editable: without it,
// GFM table rows parse as plain `Paragraph` nodes indistinguishable from real paragraphs, which would make
// a table incorrectly classify as editable instead of an island.
const markdownParser = parser.configure(GFM);

const ALLOWED_INLINE_KIND: Readonly<Record<string, EditableRun['kind']>> = {
  Emphasis: 'emphasis',
  StrongEmphasis: 'strong',
  Strikethrough: 'strikethrough',
  Link: 'link',
  Escape: 'escape',
};

export function classifyDocument(source: string): SourceBlock[] {
  const tree = markdownParser.parse(source);
  const blocks: SourceBlock[] = [];
  let node = tree.topNode.firstChild;

  while (node) {
    blocks.push(...classifyTopLevelNode(node, source));
    node = node.nextSibling;
  }

  return blocks;
}

function classifyTopLevelNode(node: SyntaxNode, source: string): SourceBlock[] {
  switch (node.type.name) {
    case 'Paragraph':
      return [classifyParagraph(node, source)];
    case 'ATXHeading1':
      return [classifyHeading(node, source, 'heading1')];
    case 'ATXHeading2':
      return [classifyHeading(node, source, 'heading2')];
    case 'ATXHeading3':
      return [classifyHeading(node, source, 'heading3')];
    case 'BulletList':
    case 'OrderedList':
      return classifyList(node, source);
    default:
      return [islandBlock(node)];
  }
}

function islandBlock(node: SyntaxNode): SourceBlock {
  return { kind: 'island', from: node.from, to: node.to, contentFrom: node.from };
}

function classifyParagraph(node: SyntaxNode, source: string): SourceBlock {
  const runs = classifyInlineChildren(node.firstChild, node.from, node.to, source);
  if (runs === null) return islandBlock(node);
  return { kind: 'paragraph', from: node.from, to: node.to, contentFrom: node.from, runs };
}

function classifyHeading(node: SyntaxNode, source: string, kind: 'heading1' | 'heading2' | 'heading3'): SourceBlock {
  const marker = node.firstChild;
  if (!marker || marker.type.name !== 'HeaderMark') return islandBlock(node);

  const contentFrom = skipOptionalSpace(source, marker.to);
  const runs = classifyInlineChildren(marker.nextSibling, contentFrom, node.to, source);
  if (runs === null) return islandBlock(node);

  return { kind, from: node.from, to: node.to, contentFrom, runs };
}

function classifyList(node: SyntaxNode, source: string): SourceBlock[] {
  const items = childrenOfType(node, 'ListItem');
  if (items.length === 0 || isLooseList(items, source)) return [islandBlock(node)];

  const isOrdered = node.type.name === 'OrderedList';
  const blocks: SourceBlock[] = [];

  for (const item of items) {
    const block = classifyListItem(item, isOrdered, source);
    if (block === null) return [islandBlock(node)];
    blocks.push(block);
  }

  return blocks;
}

function childrenOfType(node: SyntaxNode, typeName: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.type.name === typeName) result.push(child);
    child = child.nextSibling;
  }
  return result;
}

function isLooseList(items: SyntaxNode[], source: string): boolean {
  for (let i = 1; i < items.length; i++) {
    const previous = items[i - 1];
    const current = items[i];
    if (!previous || !current) continue;
    const gap = source.slice(previous.to, current.from);
    if ((gap.match(/\n/g) ?? []).length > 1) return true;
  }
  return false;
}

function classifyListItem(item: SyntaxNode, isOrdered: boolean, source: string): SourceBlock | null {
  const marker = item.firstChild;
  if (!marker || marker.type.name !== 'ListMark') return null;

  const content = marker.nextSibling;
  if (!content || content.nextSibling !== null) return null;

  if (content.type.name === 'Task') return classifyTaskItem(item, content, source);
  if (content.type.name !== 'Paragraph') return null;

  const kind: BlockKind = isOrdered ? 'ordered-item' : 'bullet-item';
  const runs = classifyInlineChildren(content.firstChild, content.from, content.to, source);
  if (runs === null) return islandBlock(item);

  if (!isOrdered) {
    return { kind, from: item.from, to: item.to, contentFrom: content.from, runs };
  }

  const orderedNumber = parseOrderedNumber(marker, source);
  if (orderedNumber === null) return null;

  return { kind, from: item.from, to: item.to, contentFrom: content.from, runs, orderedNumber };
}

function parseOrderedNumber(marker: SyntaxNode, source: string): number | null {
  const text = source.slice(marker.from, marker.to);
  const digits = /^\d+/.exec(text);
  return digits ? Number.parseInt(digits[0], 10) : null;
}

function classifyTaskItem(item: SyntaxNode, task: SyntaxNode, source: string): SourceBlock | null {
  const taskMarker = task.firstChild;
  if (!taskMarker || taskMarker.type.name !== 'TaskMarker') return null;

  const markerText = source.slice(taskMarker.from, taskMarker.to);
  if (markerText !== '[ ]' && markerText !== '[x]') return null;

  const contentFrom = skipOptionalSpace(source, taskMarker.to);
  const runs = classifyInlineChildren(taskMarker.nextSibling, contentFrom, task.to, source);
  if (runs === null) return islandBlock(item);

  return { kind: 'task-item', from: item.from, to: item.to, contentFrom, runs, taskChecked: markerText === '[x]' };
}

function skipOptionalSpace(source: string, pos: number): number {
  return source[pos] === ' ' ? pos + 1 : pos;
}

function classifyInlineChildren(
  startChild: SyntaxNode | null,
  contentFrom: number,
  contentTo: number,
  source: string,
): EditableRun[] | null {
  const runs: EditableRun[] = [];
  let pos = contentFrom;
  let child = startChild;

  while (child) {
    if (child.type.name === 'HeaderMark') {
      pos = child.to;
      child = child.nextSibling;
      continue;
    }

    const kind = ALLOWED_INLINE_KIND[child.type.name];
    if (kind === undefined) return null;

    if (kind === 'link') {
      const href = resolveLinkHref(child, source);
      if (href === null) return null;
      flushText(source, pos, child.from, runs);
      runs.push({ kind: 'link', from: child.from, to: child.to, href });
    } else {
      flushText(source, pos, child.from, runs);
      runs.push({ kind, from: child.from, to: child.to });
    }

    pos = child.to;
    child = child.nextSibling;
  }

  flushText(source, pos, contentTo, runs);
  return runs;
}

function resolveLinkHref(node: SyntaxNode, source: string): string | null {
  let child = node.firstChild;
  while (child) {
    if (child.type.name === 'URL') return source.slice(child.from, child.to);
    child = child.nextSibling;
  }
  return null;
}

function flushText(source: string, from: number, to: number, runs: EditableRun[]): void {
  if (from >= to) return;

  let segmentStart = from;
  for (let i = from; i < to; i++) {
    if (source[i] !== '\n') continue;
    if (segmentStart < i) runs.push({ kind: 'text', from: segmentStart, to: i });
    runs.push({ kind: 'softbreak', from: i, to: i + 1 });
    segmentStart = i + 1;
  }

  if (segmentStart < to) runs.push({ kind: 'text', from: segmentStart, to });
}
