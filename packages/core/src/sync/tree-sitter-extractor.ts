import { Language, Node, Parser, Query } from 'web-tree-sitter';
import { normalizeText } from '../util/hash.js';
import type { SymbolExtractor } from './symbol-extractor.js';

type LangName = 'typescript' | 'tsx' | 'javascript' | 'python';

const EXTENSION_LANGUAGE: Readonly<Record<string, LangName>> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

// TSX is a strict superset of TS grammar-wise for the node types this query cares about.
const TS_QUERY = `
  (function_declaration name: (identifier) @name) @def
  (function_signature name: (identifier) @name) @def
  (class_declaration name: (type_identifier) @name) @def
  (interface_declaration name: (type_identifier) @name) @def
  (type_alias_declaration name: (type_identifier) @name) @def
  (enum_declaration name: (identifier) @name) @def
  (variable_declarator name: (identifier) @name) @def
`;
const JS_QUERY = `
  (function_declaration name: (identifier) @name) @def
  (class_declaration name: (identifier) @name) @def
  (variable_declarator name: (identifier) @name) @def
`;
const PY_QUERY = `
  (function_definition name: (identifier) @name) @def
  (class_definition name: (identifier) @name) @def
`;

const QUERY_SOURCE: Readonly<Record<LangName, string>> = { typescript: TS_QUERY, tsx: TS_QUERY, javascript: JS_QUERY, python: PY_QUERY };
const LANGUAGE_NAMES: readonly LangName[] = ['typescript', 'tsx', 'javascript', 'python'];
/** Same budget the legacy heuristic's own pathological-input test holds itself to; a parse that blows through it is cancelled and treated as "not found" rather than blocking `prdm sync`/the post-commit hook. */
const PARSE_TIMEOUT_MS = 500;

/** `function_declaration`/`function_signature` chain into TypeScript overloads (SDD-004); nothing else does. */
const OVERLOADABLE_TYPES = new Set(['function_declaration', 'function_signature']);
/** Wrapper nodes climbed through so the captured text includes `export`, the `const`/`let`/`var` keyword, and Python decorators. */
const WRAPPER_TYPES = new Set(['export_statement', 'lexical_declaration', 'variable_declaration', 'decorated_definition']);

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

/** Whether {@link TreeSitterSymbolExtractor} has a grammar for `path`'s extension; `code-refs.ts` falls back to {@link LegacySymbolExtractor} otherwise. */
export function isTreeSitterSupported(path: string): boolean {
  return extOf(path) in EXTENSION_LANGUAGE;
}

function climbWrappers(node: Node): Node {
  let current = node;
  while (current.parent && WRAPPER_TYPES.has(current.parent.type)) current = current.parent;
  return current;
}

/** The declaration a (possibly `export`-wrapped) sibling actually carries, or null when it isn't export-wrapped-or-bare. */
function declarationOf(outer: Node): Node | null {
  return outer.type === 'export_statement' ? outer.childForFieldName('declaration') : outer;
}

function ancestorDepth(node: Node): number {
  let depth = 0;
  for (let current: Node | null = node; current.parent; current = current.parent) depth++;
  return depth;
}

/** Reconstructs the text between two AST positions by row/column, avoiding any byte-offset/UTF-16 mismatch. */
function sliceByPosition(content: string, start: { row: number; column: number }, end: { row: number; column: number }): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  if (start.row === end.row) return (lines[start.row] ?? '').slice(start.column, end.column);
  const first = (lines[start.row] ?? '').slice(start.column);
  const middle = lines.slice(start.row + 1, end.row);
  const last = (lines[end.row] ?? '').slice(0, end.column);
  return [first, ...middle, last].join('\n');
}

/**
 * Tree-sitter-based `SymbolExtractor` (SDD-004 / ADR-003): parses the real AST instead of scanning text, so
 * strings/comments never confuse brace counting and "top-level" is exact ancestor depth, not indentation.
 *
 * `extract()` is synchronous (the `SymbolExtractor` contract), so every supported language's grammar is loaded
 * once, eagerly, by {@link create}; nothing about Tree-sitter is touched before that async factory runs.
 */
export class TreeSitterSymbolExtractor implements SymbolExtractor {
  private readonly languages = new Map<LangName, Language>();
  private readonly queries = new Map<LangName, Query>();
  private readonly parser = new Parser();

  private constructor() {}

  static async create(): Promise<TreeSitterSymbolExtractor> {
    await Parser.init();
    const extractor = new TreeSitterSymbolExtractor();
    for (const name of LANGUAGE_NAMES) {
      const wasmPath = new URL(import.meta.resolve(`tree-sitter-wasms/out/tree-sitter-${name}.wasm`)).pathname;
      const language = await Language.load(wasmPath);
      extractor.languages.set(name, language);
      extractor.queries.set(name, new Query(language, QUERY_SOURCE[name]));
    }
    return extractor;
  }

  extract(content: string, symbol: string, path: string): string | null {
    const langName = EXTENSION_LANGUAGE[extOf(path)];
    const language = langName ? this.languages.get(langName) : undefined;
    const query = langName ? this.queries.get(langName) : undefined;
    if (!language || !query) return null;

    this.parser.setLanguage(language);
    const deadline = performance.now() + PARSE_TIMEOUT_MS;
    const cancelled = (): boolean => performance.now() > deadline;
    const tree = this.parser.parse(content, undefined, { progressCallback: cancelled });
    // Cancelled by the deadline above (rare: parsing itself is near-linear) or by query matching below on a
    // pathologically error-recovered tree (observed: unmatched braces can make matching a 50k-node tree alone
    // take seconds even though parsing it takes tens of milliseconds) — either way, treated as "not found".
    if (!tree) return null;

    try {
      const best = this.findTopLevelMatch(query, tree.rootNode, symbol, cancelled);
      if (!best) return null;

      const outer = climbWrappers(best);
      const end = OVERLOADABLE_TYPES.has(best.type) ? this.extendOverloadChain(outer, symbol) : outer;
      return normalizeText(sliceByPosition(content, outer.startPosition, end.endPosition));
    } finally {
      tree.delete();
    }
  }

  /** Among every match named `symbol`, prefers the shallowest ancestor depth (true top-level), then the first occurrence on a tie — same tie-break as the legacy heuristic. */
  private findTopLevelMatch(query: Query, root: Node, symbol: string, cancelled: () => boolean): Node | null {
    let best: Node | null = null;
    let bestDepth = Infinity;
    for (const m of query.matches(root, { progressCallback: cancelled })) {
      const nameNode = m.captures.find((c) => c.name === 'name')?.node;
      const defNode = m.captures.find((c) => c.name === 'def')?.node;
      if (!nameNode || !defNode || nameNode.text !== symbol) continue;
      const depth = ancestorDepth(defNode);
      if (depth < bestDepth || (depth === bestDepth && best && defNode.startIndex < best.startIndex)) {
        best = defNode;
        bestDepth = depth;
      }
    }
    return best;
  }

  /** Walks forward through sibling overload signatures with the same name, stopping at (and including) the implementation, or at the last signature if there is none. */
  private extendOverloadChain(outer: Node, symbol: string): Node {
    let end = outer;
    for (let cursor = outer.nextSibling; cursor; cursor = cursor.nextSibling) {
      const inner = declarationOf(cursor);
      if (!inner || !OVERLOADABLE_TYPES.has(inner.type) || inner.childForFieldName('name')?.text !== symbol) break;
      end = cursor;
      if (inner.type === 'function_declaration') break;
    }
    return end;
  }
}
