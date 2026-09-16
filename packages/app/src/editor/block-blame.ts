/**
 * Per-block blame for the preview editor margin (SDD-014 §"Editor de vista previa", WO-381): the exact
 * same `BlameResult` the Markdown tab's gutter already fetches (`getDocumentBlame`,
 * `collab/blame-gutter.ts`), re-presented per block instead of per CodeMirror line. `BlameResult.lines` is
 * 0-indexed and matches `body.split('\n')` (`@prdm/collab`'s `computeBlame`) — a block spans one or more of
 * those lines, and "most recently received wins" is the same tie-break `computeBlame` itself already uses.
 */
import type { BlameAttribution, BlameResult } from '@prdm/collab';
import type { SourceBlock } from './source-map.js';

function lineIndexAt(source: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset; i++) if (source[i] === '\n') line++;
  return line;
}

export function blockBlameAttribution(source: string, block: SourceBlock, blame: BlameResult): BlameAttribution | null {
  const lastOffset = Math.max(block.from, block.to - 1);
  const firstLine = lineIndexAt(source, block.from);
  const lastLine = lineIndexAt(source, lastOffset);

  let best: BlameAttribution | null = null;
  for (let line = firstLine; line <= lastLine; line++) {
    const attribution = blame.lines[line]?.attribution ?? null;
    if (attribution && (!best || attribution.receivedAt > best.receivedAt)) best = attribution;
  }
  return best;
}
