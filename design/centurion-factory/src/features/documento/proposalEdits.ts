/**
 * Matches an agent proposal's `expectedText` (a single Markdown line) against the current block
 * model (WO-289). Deliberately minimal — WO-300's markdown.ts owns full serialize/parse.
 */
import type { DocumentBlock } from '../../data';

function linePrefix(block: DocumentBlock): string {
  if (block.type === 'h1') return '# ';
  if (block.type === 'h2') return '## ';
  if (block.type === 'h3') return '### ';
  if (block.type === 'li') return '- ';
  if (block.type === 'task') return block.checked ? '- [x] ' : '- [ ] ';
  return '';
}

/** The plain Markdown line a block would serialize to, ignoring inline emphasis. */
export function blockToLine(block: DocumentBlock): string {
  return `${linePrefix(block)}${block.text}`;
}

/** The block, if any, whose current line still matches the proposal's `expectedText`. */
export function findMatchingBlock(blocks: readonly DocumentBlock[], expectedText: string): DocumentBlock | undefined {
  return blocks.find((block) => blockToLine(block) === expectedText.trim());
}

/** Strips a Markdown line prefix so the replacement can become a block's plain `text`. */
export function stripLinePrefix(line: string): string {
  return line.replace(/^(#{1,3}\s|-\s\[[ x]\]\s|-\s)/, '');
}
