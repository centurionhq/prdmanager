/**
 * Pure Markdown serialize/parse for the block model (WO-300). The block model is always the
 * source of truth: `serializeBlocks` renders it to the Markdown tab, `parseMarkdown` re-derives a
 * block shape from edited Markdown when switching back to Vista previa.
 */
import type { BlockType, DocumentBlock } from '../../data';

export interface ParsedLine {
  readonly type: BlockType;
  readonly text: string;
  readonly checked?: boolean;
}

const HEADING_PATTERNS: readonly [RegExp, BlockType][] = [
  [/^###\s(.*)$/, 'h3'],
  [/^##\s(.*)$/, 'h2'],
  [/^#\s(.*)$/, 'h1'],
];

const TASK_PATTERN = /^-\s\[( |x|X)\]\s(.*)$/;
const BULLET_PATTERN = /^-\s(.*)$/;
const ORDERED_PATTERN = /^\d+\.\s(.*)$/;

/** How many consecutive `ol` blocks immediately precede `index` (for "1.", "2." numbering). */
function orderedNumberAt(blocks: readonly DocumentBlock[], index: number): number {
  let count = 1;
  for (let cursor = index - 1; cursor >= 0 && blocks[cursor]?.type === 'ol'; cursor -= 1) count += 1;
  return count;
}

function lineForBlock(block: DocumentBlock, orderedNumber: number): string {
  if (block.type === 'h1') return `# ${block.text}`;
  if (block.type === 'h2') return `## ${block.text}`;
  if (block.type === 'h3') return `### ${block.text}`;
  if (block.type === 'li') return `- ${block.text}`;
  if (block.type === 'ol') return `${orderedNumber}. ${block.text}`;
  if (block.type === 'task') return `- [${block.checked ? 'x' : ' '}] ${block.text}`;
  return block.text;
}

/** A block needs a blank separator line before it when it (or its predecessor) is prose. */
function needsBlankBefore(block: DocumentBlock, previous: DocumentBlock): boolean {
  const isProseOrHeading = (type: BlockType): boolean => type === 'p' || type === 'h1' || type === 'h2' || type === 'h3';
  return isProseOrHeading(block.type) || previous.type === 'p';
}

/** Renders the block model to Markdown source, one block per line with blank-line separators. */
export function serializeBlocks(blocks: readonly DocumentBlock[]): string {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    if (previous && needsBlankBefore(block, previous)) lines.push('');
    lines.push(lineForBlock(block, orderedNumberAt(blocks, index)));
  });
  return lines.join('\n');
}

/** Parses one Markdown line into its block type/text/checked shape; blank lines return `null`. */
export function parseLine(line: string): ParsedLine | null {
  if (line.trim() === '') return null;

  for (const [pattern, type] of HEADING_PATTERNS) {
    const match = pattern.exec(line);
    if (match) return { type, text: match[1] ?? '' };
  }

  const task = TASK_PATTERN.exec(line);
  if (task) return { type: 'task', text: task[2] ?? '', checked: task[1]?.toLowerCase() === 'x' };

  const ordered = ORDERED_PATTERN.exec(line);
  if (ordered) return { type: 'ol', text: line.replace(/^\d+\.\s/, '') };

  const bullet = BULLET_PATTERN.exec(line);
  if (bullet) return { type: 'li', text: bullet[1] ?? '' };

  return { type: 'p', text: line };
}

/** Parses full Markdown source into an ordered list of block shapes, skipping blank lines. */
export function parseMarkdown(source: string): readonly ParsedLine[] {
  return source
    .split('\n')
    .map(parseLine)
    .filter((line): line is ParsedLine => line !== null);
}

// ── Inline formatting (WYSIWYG round-trip between Markdown and the contentEditable DOM) ────────

type InlineNode =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bold'; readonly children: readonly InlineNode[] }
  | { readonly kind: 'italic'; readonly children: readonly InlineNode[] }
  | { readonly kind: 'strike'; readonly children: readonly InlineNode[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly InlineNode[] };

const LINK_PATTERN = /^\[([^\]]*)\]\(([^)]*)\)/;

/** Recursive-descent inline parser: `**`, `_`, `~~` and `[text](url)`, nestable inside each other. */
function parseInline(source: string): readonly InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  let cursor = 0;

  function flush(): void {
    if (buffer) {
      nodes.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  }

  while (cursor < source.length) {
    if (source.startsWith('**', cursor)) {
      const close = source.indexOf('**', cursor + 2);
      if (close !== -1) {
        flush();
        nodes.push({ kind: 'bold', children: parseInline(source.slice(cursor + 2, close)) });
        cursor = close + 2;
        continue;
      }
    }
    if (source.startsWith('~~', cursor)) {
      const close = source.indexOf('~~', cursor + 2);
      if (close !== -1) {
        flush();
        nodes.push({ kind: 'strike', children: parseInline(source.slice(cursor + 2, close)) });
        cursor = close + 2;
        continue;
      }
    }
    if (source[cursor] === '_') {
      const close = source.indexOf('_', cursor + 1);
      if (close !== -1) {
        flush();
        nodes.push({ kind: 'italic', children: parseInline(source.slice(cursor + 1, close)) });
        cursor = close + 1;
        continue;
      }
    }
    if (source[cursor] === '[') {
      const match = LINK_PATTERN.exec(source.slice(cursor));
      if (match) {
        flush();
        nodes.push({ kind: 'link', href: match[2] ?? '', children: parseInline(match[1] ?? '') });
        cursor += match[0].length;
        continue;
      }
    }
    buffer += source[cursor];
    cursor += 1;
  }
  flush();
  return nodes;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function renderInlineNode(node: InlineNode): string {
  if (node.kind === 'text') return escapeHtml(node.value);
  const inner = node.children.map(renderInlineNode).join('');
  if (node.kind === 'bold') return `<strong>${inner}</strong>`;
  if (node.kind === 'italic') return `<em>${inner}</em>`;
  if (node.kind === 'strike') return `<del>${inner}</del>`;
  return `<a href="${escapeAttribute(node.href)}">${inner}</a>`;
}

/** A single block's plain Markdown text (may contain `**`/`_`/`~~`/links) to safe inline HTML. */
export function inlineToHtml(text: string): string {
  return parseInline(text)
    .map(renderInlineNode)
    .join('');
}

const INLINE_TAGS: Readonly<Record<string, string>> = {
  STRONG: '**',
  B: '**',
  EM: '_',
  I: '_',
  DEL: '~~',
  S: '~~',
  STRIKE: '~~',
};

function domNodeToInline(node: ChildNode): string {
  if (node.nodeType === 3 /* Node.TEXT_NODE */) return node.textContent ?? '';
  if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) return '';

  const element = node as Element;
  const inner = Array.from(element.childNodes).map(domNodeToInline).join('');
  const marker = INLINE_TAGS[element.tagName];
  if (marker) return `${marker}${inner}${marker}`;
  if (element.tagName === 'A') return `[${inner}](${element.getAttribute('href') ?? ''})`;
  if (element.tagName === 'BR') return '\n';
  // Browsers sometimes wrap content in <div>/<p> (e.g. after Enter); flatten them.
  return inner;
}

/** The inverse of `inlineToHtml`: a contentEditable block's `innerHTML` back to plain Markdown. */
export function htmlToInline(html: string): string {
  const parsedDocument = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return Array.from(parsedDocument.body.childNodes).map(domNodeToInline).join('');
}

let nextGeneratedId = 0;

/** Test-only escape hatch so id generation stays deterministic across unit tests. */
export function resetGeneratedIdsForTests(): void {
  nextGeneratedId = 0;
}

/**
 * Reconciles parsed Markdown lines against the previous blocks: a line at the same position keeps
 * its id/authorship (it was "edited"), a new line is attributed to `fallbackAuthor`.
 */
export function reconcileBlocks(
  previousBlocks: readonly DocumentBlock[],
  parsedLines: readonly ParsedLine[],
  fallbackAuthor: string,
): readonly DocumentBlock[] {
  return parsedLines.map((line, index) => {
    const previous = previousBlocks[index];
    if (previous) {
      return { ...previous, type: line.type, text: line.text, checked: line.checked };
    }
    nextGeneratedId += 1;
    return { id: `block-${Date.now()}-${nextGeneratedId}`, type: line.type, text: line.text, checked: line.checked, author: fallbackAuthor };
  });
}
