/**
 * Matches parsed Markdown lines against the previous block model by text similarity (WO-312), so
 * inserting or removing a line no longer reshuffles everyone else's authorship. Tiers, in order:
 * exact text, normalized (trim/case/whitespace) text, LCS-based similarity, then position.
 */
import type { DocumentBlock } from '../../data';
import { generateBlockId, type ParsedLine } from './markdown';

const SIMILARITY_THRESHOLD = 0.6;

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Length of the longest common subsequence of characters between `a` and `b`. */
function lcsLength(a: string, b: string): number {
  let previousRow = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      currentRow[j] = a[i - 1] === b[j - 1] ? (previousRow[j - 1] ?? 0) + 1 : Math.max(previousRow[j] ?? 0, currentRow[j - 1] ?? 0);
    }
    previousRow = currentRow;
  }
  return previousRow[b.length] ?? 0;
}

/** 0..1 similarity ratio: the LCS length relative to the longer of the two strings. */
function similarityRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return lcsLength(a, b) / longest;
}

interface Candidate {
  readonly block: DocumentBlock;
}

/** Mutable matching state threaded through each tier: which lines/candidates are still free. */
interface MatchState {
  readonly pairs: Map<number, Candidate>;
  readonly lineTaken: boolean[];
  readonly candidates: (Candidate | undefined)[];
}

/** Greedily pairs each still-free line with the first still-free candidate whose text `matches` it. */
function matchByPredicate(lines: readonly ParsedLine[], state: MatchState, matches: (line: ParsedLine, candidate: Candidate) => boolean): void {
  lines.forEach((line, lineIndex) => {
    if (state.lineTaken[lineIndex]) return;
    const candidateIndex = state.candidates.findIndex((candidate) => candidate && matches(line, candidate));
    if (candidateIndex === -1) return;
    const candidate = state.candidates[candidateIndex];
    if (!candidate) return;
    state.pairs.set(lineIndex, candidate);
    state.candidates[candidateIndex] = undefined;
    state.lineTaken[lineIndex] = true;
  });
}

/** Repeatedly pairs the single best remaining (line, candidate) match at or above the threshold. */
function matchBySimilarity(lines: readonly ParsedLine[], state: MatchState): void {
  for (;;) {
    let best: { readonly lineIndex: number; readonly candidateIndex: number; readonly score: number } | undefined;
    lines.forEach((line, lineIndex) => {
      if (state.lineTaken[lineIndex]) return;
      state.candidates.forEach((candidate, candidateIndex) => {
        if (!candidate) return;
        const score = similarityRatio(line.text, candidate.block.text);
        if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { lineIndex, candidateIndex, score };
      });
    });
    if (!best) return;
    const candidate = state.candidates[best.candidateIndex];
    if (!candidate) return;
    state.pairs.set(best.lineIndex, candidate);
    state.candidates[best.candidateIndex] = undefined;
    state.lineTaken[best.lineIndex] = true;
  }
}

/** Last resort: a still-free line keeps the still-free candidate that was at the very same index. */
function matchByPosition(lines: readonly ParsedLine[], state: MatchState): void {
  lines.forEach((_line, lineIndex) => {
    if (state.lineTaken[lineIndex]) return;
    const candidate = state.candidates[lineIndex];
    if (!candidate) return;
    state.pairs.set(lineIndex, candidate);
    state.candidates[lineIndex] = undefined;
    state.lineTaken[lineIndex] = true;
  });
}

/**
 * Reconciles parsed Markdown lines against the previous blocks: matches by exact text, then
 * normalized text, then similarity, then position, so an insertion/deletion elsewhere doesn't
 * reattribute unrelated lines. `acceptedBy` is dropped whenever the matched text actually changed.
 */
export function reconcileBlocks(
  previousBlocks: readonly DocumentBlock[],
  parsedLines: readonly ParsedLine[],
  fallbackAuthor: string,
): readonly DocumentBlock[] {
  const state: MatchState = {
    pairs: new Map(),
    lineTaken: parsedLines.map(() => false),
    candidates: previousBlocks.map((block) => ({ block })),
  };

  matchByPredicate(parsedLines, state, (line, candidate) => line.text === candidate.block.text);
  matchByPredicate(parsedLines, state, (line, candidate) => normalizeText(line.text) === normalizeText(candidate.block.text));
  matchBySimilarity(parsedLines, state);
  matchByPosition(parsedLines, state);

  return parsedLines.map((line, lineIndex) => {
    const match = state.pairs.get(lineIndex);
    if (!match) return { id: generateBlockId(), type: line.type, text: line.text, checked: line.checked, author: fallbackAuthor };

    const textChanged = match.block.text !== line.text;
    return {
      ...match.block,
      type: line.type,
      text: line.text,
      checked: line.checked,
      acceptedBy: textChanged ? undefined : match.block.acceptedBy,
    };
  });
}
