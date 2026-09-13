import fg from 'fast-glob';
import { normalizeText, sha256 } from '../util/hash.js';
import { resolveInside } from '../util/paths.js';
import { safeReadFile } from '../util/safe-fs.js';

export interface CodeRefState {
  key: string;
  path: string;
  symbol: string | null;
  hash: string | null;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function resolveGoverned(
  root: string,
  patterns: string[],
  ignore: string[],
): Promise<{ refs: CodeRefState[]; warnings: string[] }> {
  const refs = new Map<string, CodeRefState>();
  const warnings: string[] = [];

  for (const pattern of patterns) {
    const hashIndex = pattern.indexOf('#');
    const filePart = hashIndex === -1 ? pattern : pattern.slice(0, hashIndex);
    const symbol = hashIndex === -1 ? null : pattern.slice(hashIndex + 1);
    let rel: string;
    try {
      rel = resolveInside(root, filePart).rel;
    } catch {
      warnings.push(`governs pattern "${pattern}" is outside the repository or invalid`);
      continue;
    }
    const files = fg.isDynamicPattern(rel)
      ? (await fg.glob(rel, { cwd: root, ignore, onlyFiles: true, dot: false, followSymbolicLinks: false })).sort()
      : [rel];
    if (files.length === 0) warnings.push(`governs pattern "${pattern}" matches no files`);

    for (const path of files) {
      const key = symbol ? `${path}#${symbol}` : path;
      if (refs.has(key)) continue;
      const { hash, warning } = await hashRef(root, path, symbol);
      if (warning) warnings.push(warning);
      refs.set(key, { key, path, symbol, hash });
    }
  }
  return { refs: [...refs.values()], warnings };
}

async function hashRef(root: string, path: string, symbol: string | null): Promise<{ hash: string | null; warning?: string }> {
  let content: string | null;
  try {
    content = await safeReadFile(root, path);
  } catch (err) {
    return { hash: null, warning: `governed path "${path}" was not hashed: ${(err as Error).message}` };
  }
  if (content === null) return { hash: null };
  const text = symbol ? extractSymbol(content, symbol, path) : normalizeText(content);
  return { hash: text === null ? null : sha256(text) };
}

/** Best-effort extraction of a declaration block (braces for TS/JS, indentation for Python); braces inside strings are not special-cased. */
export function extractSymbol(content: string, symbol: string, path: string): string | null {
  if (!IDENTIFIER.test(symbol)) return null;
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const name = escapeRegex(symbol);
  const isPython = path.endsWith('.py');
  const decl = isPython
    ? new RegExp(`^(\\s*)(async\\s+)?(def|class)\\s+${name}(?![\\w$])`)
    : new RegExp(
        `^(\\s*)(export\\s+)?(default\\s+)?(declare\\s+)?(abstract\\s+)?(async\\s+)?(function\\*?|class|interface|type|enum|const|let|var)\\s+${name}(?![\\w$])`,
      );
  const start = lines.findIndex((line) => decl.test(line));
  if (start === -1) return null;
  const end = isPython ? pythonBlockEnd(lines, start) : braceBlockEnd(lines, start);
  return normalizeText(lines.slice(start, end + 1).join('\n'));
}

function pythonBlockEnd(lines: string[], start: number): number {
  const indentOf = (line: string): number => line.length - line.trimStart().length;
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

function braceBlockEnd(lines: string[], start: number): number {
  let depth = 0;
  let parens = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') depth--;
      else if (ch === '(') parens++;
      else if (ch === ')') parens--;
    }
    if (opened && depth <= 0) return i;
    if (!opened && parens <= 0 && !/(=>|=|,|\(|:)\s*$/.test(line.trim())) return i;
  }
  return lines.length - 1;
}
