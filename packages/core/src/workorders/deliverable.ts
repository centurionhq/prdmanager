export type DeliverableKind = 'code' | 'gate';

const DELIVERABLE_LINE = /^deliverable:\s*(\S+)\s*$/i;
const COMBINING_MARKS = /[̀-ͯ]/g;
const VERIFICATION_STEM = 'verificaci';
const GATE_WORD = 'gate';

/** Lowercase + accent-free (NFD with combining marks stripped). */
export function normalizeForClassify(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9_]/.test(c);

/** True when `needle` appears in `haystack` starting at a word boundary; `wholeWord` also requires one at its end. */
function hasWord(haystack: string, needle: string, wholeWord: boolean): boolean {
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (isWordChar(haystack[at - 1])) continue;
    if (!wholeWord || !isWordChar(haystack[at + needle.length])) return true;
  }
  return false;
}

/** SDD-093 D2: `gate` only when the text declares the PAIR `verificaci*` (word-start stem) and the standalone word `gate`. */
export function classifyDeliverable(text: string): DeliverableKind {
  const normalized = normalizeForClassify(text);
  return hasWord(normalized, VERIFICATION_STEM, false) && hasWord(normalized, GATE_WORD, true) ? 'gate' : 'code';
}

/** Reads a `deliverable: gate|code` declaration line; any other value (or line) yields null. */
export function parseDeliverableDeclaration(line: string): DeliverableKind | null {
  const value = DELIVERABLE_LINE.exec(line.trim())?.[1]?.toLowerCase();
  return value === 'gate' || value === 'code' ? value : null;
}
