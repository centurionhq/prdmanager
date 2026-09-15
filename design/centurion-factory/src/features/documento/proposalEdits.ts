/**
 * Matches an agent proposal's `expectedText` (a single Markdown line) against the current block
 * model (WO-289). Reuses the real serializer/parser from markdown.ts (WO-313) instead of keeping a
 * second, drifted copy that was missing the `ol` numbering case.
 */
import type { DocumentBlock } from '../../data';
import { parseLine, serializeBlocks } from './markdown';

/** The block, if any, whose current line still matches the proposal's `expectedText`. */
export function findMatchingBlock(blocks: readonly DocumentBlock[], expectedText: string): DocumentBlock | undefined {
  const { source, lineBlockIds } = serializeBlocks(blocks);
  const trimmedExpected = expectedText.trim();
  const lineIndex = source.split('\n').findIndex((line, index) => lineBlockIds[index] !== undefined && line === trimmedExpected);
  if (lineIndex === -1) return undefined;

  const blockId = lineBlockIds[lineIndex];
  return blocks.find((block) => block.id === blockId);
}

/** Strips a Markdown line prefix so the replacement can become a block's plain `text`. */
export function stripLinePrefix(line: string): string {
  return parseLine(line)?.text ?? line;
}
