import { normalizeText } from '../util/hash.js';
import type { SymbolExtractor } from './symbol-extractor.js';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CONTINUATION_SUFFIXES = ['=>', '=', ',', '(', '|', '&', '+'];
const CONTINUATION_PREFIXES = ['.', '|', '&', '?', ':'];
const STATEMENT_KEYWORDS = new Set(['const', 'let', 'var', 'type']);

const tsDeclRegex = (name: string): RegExp =>
  new RegExp(
    `^(\\s*)(export\\s+)?(default\\s+)?(declare\\s+)?(abstract\\s+)?(async\\s+)?(function\\*?|class|interface|type|enum|const|let|var)\\s+${name}(?![\\w$])`,
  );
const pyDeclRegex = (name: string): RegExp => new RegExp(`^(\\s*)(async\\s+)?(def|class)\\s+${name}(?![\\w$])`);

/**
 * Pre-Tree-sitter heuristic (SDD-004): a linear, text-only scan. Kept as the fallback `SymbolExtractor` for any
 * file extension {@link TreeSitterSymbolExtractor} doesn't have a grammar for, and as the baseline the hash
 * comparison in `symbol-extractor-comparison.test.ts` measures Tree-sitter against.
 *
 * TS/JS: prefers the shallowest-indented (top-level) declaration, hashes overload signatures through the
 * implementation body, ignores braces/parens inside strings and comments, and tracks multi-line statements
 * (unions, chained builders) until they truly terminate. Python stays indentation-based, including decorators.
 * When a block is ambiguous or never closes, extraction falls back to end of file so drift is over-reported
 * rather than missed.
 */
export class LegacySymbolExtractor implements SymbolExtractor {
  extract(content: string, symbol: string, path: string): string | null {
    if (!IDENTIFIER.test(symbol)) return null;
    const lines = content.replace(/\r\n?/g, '\n').split('\n');
    const name = escapeRegex(symbol);
    const isPython = path.endsWith('.py');
    const regex = isPython ? pyDeclRegex(name) : tsDeclRegex(name);
    const found = findTopLevelDecl(lines, regex);
    if (!found) return null;

    const start = isPython ? pythonDeclStart(lines, found.index) : found.index;
    const end = isPython ? pythonBlockEnd(lines, found.index) : tsBlockEnd(lines, found.index, found.match, regex);
    return normalizeText(lines.slice(start, end + 1).join('\n'));
  }
}

function findTopLevelDecl(lines: string[], regex: RegExp): { index: number; match: RegExpMatchArray } | null {
  let best: { index: number; match: RegExpMatchArray } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = regex.exec(lines[i] ?? '');
    if (!match) continue;
    const indent = (match[1] ?? '').length;
    if (!best || indent < (best.match[1] ?? '').length) best = { index: i, match };
  }
  return best;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function pythonDeclStart(lines: string[], start: number): number {
  const indent = indentOf(lines[start] ?? '');
  let i = start - 1;
  while (i >= 0) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || indentOf(line) !== indent || !line.trim().startsWith('@')) break;
    i--;
  }
  return i + 1;
}

function pythonBlockEnd(lines: string[], start: number): number {
  const baseIndent = indentOf(lines[start] ?? '');
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    if (indentOf(line) <= baseIndent) break;
    last = i;
  }
  return last;
}

function tsBlockEnd(lines: string[], start: number, match: RegExpMatchArray, declRegex: RegExp): number {
  const keyword = match[7] ?? '';
  return STATEMENT_KEYWORDS.has(keyword) ? declStatementEnd(lines, start) : functionLikeBlockEnd(lines, start, declRegex);
}

/** Chains through consecutive overload signatures (ending in `;`, no `{`) until the implementation body opens. */
function functionLikeBlockEnd(lines: string[], start: number, declRegex: RegExp): number {
  let cursor = start;
  for (;;) {
    const { end, opened } = singleDeclBlockEnd(lines, cursor);
    if (opened) return end;
    const next = nextNonBlankLineIndex(lines, end + 1);
    if (next === -1 || !declRegex.test(lines[next] ?? '')) return end;
    cursor = next;
  }
}

function singleDeclBlockEnd(lines: string[], start: number): { end: number; opened: boolean } {
  let braceDepth = 0;
  let parenDepth = 0;
  let opened = false;
  let inBlockComment = false;
  for (let i = start; i < lines.length; i++) {
    const scanned = sanitizeLine(lines[i] ?? '', inBlockComment);
    inBlockComment = scanned.inBlockComment;
    for (const ch of scanned.code) {
      if (ch === '{') {
        braceDepth++;
        opened = true;
      } else if (ch === '}') braceDepth--;
      else if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
    }
    if (opened && braceDepth <= 0) return { end: i, opened: true };
    if (!opened && parenDepth <= 0 && !endsWithContinuationOperator(scanned.code.trimEnd())) {
      return { end: i, opened: false };
    }
  }
  return { end: lines.length - 1, opened };
}

/** Handles const/let/var/type statements, including multi-line unions and chained calls. */
function declStatementEnd(lines: string[], start: number): number {
  let braceDepth = 0;
  let parenDepth = 0;
  let inBlockComment = false;
  for (let i = start; i < lines.length; i++) {
    const scanned = sanitizeLine(lines[i] ?? '', inBlockComment);
    inBlockComment = scanned.inBlockComment;
    for (const ch of scanned.code) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
    }
    if (braceDepth > 0 || parenDepth > 0) continue;
    const trimmed = scanned.code.trimEnd();
    if (trimmed.endsWith(';')) return i;
    if (endsWithContinuationOperator(trimmed) || nextLineStartsContinuation(lines, i + 1)) continue;
    return i;
  }
  return lines.length - 1;
}

function endsWithContinuationOperator(text: string): boolean {
  return CONTINUATION_SUFFIXES.some((suffix) => text.endsWith(suffix));
}

function nextLineStartsContinuation(lines: string[], from: number): boolean {
  const idx = nextNonBlankLineIndex(lines, from);
  if (idx === -1) return false;
  const trimmed = (lines[idx] ?? '').trim();
  return CONTINUATION_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function nextNonBlankLineIndex(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() !== '') return i;
  }
  return -1;
}

/** Linear scan that strips string/template literals and `//` and single-line `/* *\/` comments from a line. */
function sanitizeLine(line: string, inBlockComment: boolean): { code: string; inBlockComment: boolean } {
  const codeChars: string[] = [];
  let comment = inBlockComment;
  let i = 0;
  while (i < line.length) {
    if (comment) {
      const closeIdx = line.indexOf('*/', i);
      if (closeIdx === -1) return { code: codeChars.join(''), inBlockComment: true };
      comment = false;
      i = closeIdx + 2;
      continue;
    }
    const ch = line[i];
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '/' && line[i + 1] === '*') {
      comment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipStringLiteral(line, i, ch);
      continue;
    }
    codeChars.push(ch ?? '');
    i++;
  }
  return { code: codeChars.join(''), inBlockComment: comment };
}

function skipStringLiteral(line: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line[i] === quote) return i + 1;
    i++;
  }
  return line.length;
}
