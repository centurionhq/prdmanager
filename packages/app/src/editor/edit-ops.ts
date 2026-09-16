import type { SourceBlock } from './source-map.js';

export interface Splice {
  from: number;
  to: number;
  insert: string;
}

const ALWAYS_ESCAPE = new Set(['\\', '*', '_', '~', '[', ']', '`']);
const LEADING_ESCAPE = new Set(['#', '-', '+']);

export function escapeMarkdownText(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const needsEscape = ALWAYS_ESCAPE.has(char) || (i === 0 && LEADING_ESCAPE.has(char));
    result += needsEscape ? `\\${char}` : char;
  }
  return result;
}

const PROTECTED_TAREAS_HEADING = '## Tareas';

// The `## Tareas` guard needs the block's literal text, not just its `kind` (any heading2 with that exact
// content is protected) — `SourceBlock` only carries offsets, so the guarded functions accept `source` too.
// Exported so callers outside this module (Toolbar.tsx) can disable a UI affordance up front instead of
// only ever finding out from a thrown error.
export function isProtectedTareasHeading(block: SourceBlock, source: string): boolean {
  return block.kind === 'heading2' && source.slice(block.from, block.to) === PROTECTED_TAREAS_HEADING;
}

function assertNotProtectedTareasHeading(block: SourceBlock, source: string): void {
  if (isProtectedTareasHeading(block, source)) {
    throw new Error('El encabezado ## Tareas no se puede editar desde la vista previa');
  }
}

export function insertText(block: SourceBlock, offsetInBlock: number, text: string, source: string): Splice {
  assertNotProtectedTareasHeading(block, source);
  const pos = block.contentFrom + offsetInBlock;
  return { from: pos, to: pos, insert: escapeMarkdownText(text) };
}

export function deleteRange(block: SourceBlock, fromInBlock: number, toInBlock: number, source: string): Splice {
  assertNotProtectedTareasHeading(block, source);
  return { from: block.contentFrom + fromInBlock, to: block.contentFrom + toInBlock, insert: '' };
}

export function splitBlock(block: SourceBlock, atOffsetInBlock: number, source: string): Splice {
  assertNotProtectedTareasHeading(block, source);
  const pos = block.contentFrom + atOffsetInBlock;
  return { from: pos, to: pos, insert: splitInsertFor(block, source) };
}

function splitInsertFor(block: SourceBlock, source: string): string {
  switch (block.kind) {
    case 'paragraph':
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return '\n\n';
    case 'bullet-item':
      return `\n${source[block.from] ?? '-'} `;
    case 'ordered-item':
      return `\n${(block.orderedNumber ?? 0) + 1}. `;
    case 'task-item':
      return '\n- [ ] ';
    case 'island':
      throw new Error('No se puede dividir un bloque island');
  }
}

export function joinBlocks(firstBlock: SourceBlock, secondBlock: SourceBlock, sourceBetween: string): Splice | null {
  if (!/^\s*$/.test(sourceBetween)) return null;
  return { from: firstBlock.to, to: secondBlock.from, insert: ' ' };
}

type ToggleableMark = 'strong' | 'emphasis' | 'strikethrough';

const MARK_DELIMITER: Readonly<Record<ToggleableMark, string>> = {
  strong: '**',
  emphasis: '*',
  strikethrough: '~~',
};

export function toggleMark(
  block: SourceBlock,
  fromInBlock: number,
  toInBlock: number,
  mark: ToggleableMark,
  source: string,
): Splice | null {
  const [selFrom, selTo] = trimWhitespace(source, block.contentFrom + fromInBlock, block.contentFrom + toInBlock);
  const matchingRuns = (block.runs ?? []).filter((run) => run.kind === mark);

  const wrappingRun = matchingRuns.find((run) => run.from <= selFrom && run.to >= selTo);
  if (wrappingRun) {
    const delimiterLength = MARK_DELIMITER[mark].length;
    const inner = source.slice(wrappingRun.from + delimiterLength, wrappingRun.to - delimiterLength);
    return { from: wrappingRun.from, to: wrappingRun.to, insert: inner };
  }

  const overlapsPartially = matchingRuns.some((run) => run.from < selTo && run.to > selFrom);
  if (overlapsPartially) return null;

  const delimiter = MARK_DELIMITER[mark];
  const text = source.slice(selFrom, selTo);
  return { from: selFrom, to: selTo, insert: `${delimiter}${text}${delimiter}` };
}

function trimWhitespace(source: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start] ?? '')) start++;
  while (end > start && /\s/.test(source[end - 1] ?? '')) end--;
  return [start, end];
}

const HEADING_PREFIX: Readonly<Record<'heading1' | 'heading2' | 'heading3', string>> = {
  heading1: '# ',
  heading2: '## ',
  heading3: '### ',
};

export function setBlockType(
  block: SourceBlock,
  newKind: 'paragraph' | 'heading1' | 'heading2' | 'heading3',
  source: string,
): Splice {
  assertNotProtectedTareasHeading(block, source);
  const insert = newKind === 'paragraph' ? '' : HEADING_PREFIX[newKind];
  return { from: block.from, to: block.contentFrom, insert };
}

const TASK_CHECKBOX_OFFSET_FROM_CONTENT = 3;

export function toggleTask(block: SourceBlock): Splice {
  if (block.kind !== 'task-item') {
    throw new Error('toggleTask solo puede llamarse sobre un bloque task-item');
  }
  const checkboxPos = block.contentFrom - TASK_CHECKBOX_OFFSET_FROM_CONTENT;
  return { from: checkboxPos, to: checkboxPos + 1, insert: block.taskChecked ? ' ' : 'x' };
}

const SAFE_HREF_PATTERN = /^(https?:\/\/|mailto:|\/)/;

export function insertLink(
  block: SourceBlock,
  fromInBlock: number,
  toInBlock: number,
  href: string,
  source: string,
): Splice {
  const from = block.contentFrom + fromInBlock;
  const to = block.contentFrom + toInBlock;
  const text = source.slice(from, to);
  const safeHref = SAFE_HREF_PATTERN.test(href) ? href : '#';
  return { from, to, insert: `[${text}](${safeHref})` };
}
