import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { glob, isDynamicPattern } from 'tinyglobby';
import { findNestedProjectRoots } from '../project/discover.js';
import { normalizeText, sha256 } from '../util/hash.js';
import { resolveInside } from '../util/paths.js';
import { safeReadFile } from '../util/safe-fs.js';
import { LegacySymbolExtractor } from './legacy-extractor.js';
import type { SymbolCache } from './symbol-cache.js';
import type { SymbolExtractor } from './symbol-extractor.js';
import { isTreeSitterSupported, TreeSitterSymbolExtractor } from './tree-sitter-extractor.js';

export interface CodeRefState {
  key: string;
  path: string;
  symbol: string | null;
  hash: string | null;
}

const legacyExtractor = new LegacySymbolExtractor();

/** Standalone entry point kept for direct unit testing of the heuristic (SDD-004 moved its body to {@link LegacySymbolExtractor}). */
export function extractSymbol(content: string, symbol: string, path: string): string | null {
  return legacyExtractor.extract(content, symbol, path);
}

/** Tree-sitter for the extensions it has a grammar for, the pre-Tree-sitter heuristic for everything else. */
class DispatchingSymbolExtractor implements SymbolExtractor {
  constructor(
    private readonly treeSitter: TreeSitterSymbolExtractor,
    private readonly legacy: SymbolExtractor,
  ) {}

  extract(content: string, symbol: string, path: string): string | null {
    return (isTreeSitterSupported(path) ? this.treeSitter : this.legacy).extract(content, symbol, path);
  }
}

// Loaded once per process, and only the first time a `#symbol` pattern is actually resolved (SDD-004 "carga
// perezosa"): a project whose blueprints govern only whole files never touches Tree-sitter's WASM runtime.
let treeSitterPromise: Promise<TreeSitterSymbolExtractor> | undefined;

async function defaultExtractorFor(symbol: string | null): Promise<SymbolExtractor | null> {
  if (!symbol) return null; // never dereferenced: hashRef only calls the extractor when there's a symbol
  treeSitterPromise ??= TreeSitterSymbolExtractor.create();
  return new DispatchingSymbolExtractor(await treeSitterPromise, legacyExtractor);
}

export interface ResolveGovernedOptions {
  /** Overrides the default (Tree-sitter, falling back to the legacy heuristic) extractor. */
  extractor?: SymbolExtractor;
  /** SDD-004 perf cache: skips re-extracting a symbol whose file hasn't changed since it was last cached. */
  cache?: SymbolCache;
}

/** WO-464 (SDD-032): a static `impacts_paths` entry that names a directory rather than a file. `false` for
 * anything else (a real file, or a path that doesn't exist at all) -- those keep going through the
 * existing single-file path unchanged. */
async function isDirectory(root: string, rel: string): Promise<boolean> {
  try {
    return (await fs.stat(join(root, rel))).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveGoverned(
  root: string,
  patterns: string[],
  ignore: string[],
  options: ResolveGovernedOptions = {},
): Promise<{ refs: CodeRefState[]; warnings: string[] }> {
  const refs = new Map<string, CodeRefState>();
  const warnings: string[] = [];
  // A subdirectory with its own .prdm.yaml is another project (SDD-002 "Proyecto activo"): never govern its files.
  const nestedRoots = await findNestedProjectRoots(root, ignore);
  const effectiveIgnore = [...ignore, ...nestedRoots.map((rel) => `${rel}/**`)];

  for (const pattern of patterns) {
    const hashIndex = pattern.indexOf('#');
    const filePart = hashIndex === -1 ? pattern : pattern.slice(0, hashIndex);
    const symbol = hashIndex === -1 ? null : pattern.slice(hashIndex + 1);
    let rel: string;
    try {
      rel = resolveInside(root, filePart).rel;
    } catch {
      warnings.push(`impacts_paths pattern "${pattern}" is outside the repository or invalid`);
      continue;
    }
    const nested = nestedRoots.find((dir) => rel === dir || rel.startsWith(`${dir}/`));
    if (nested !== undefined) {
      warnings.push(`impacts_paths pattern "${pattern}" belongs to nested project "${nested}"`);
      continue;
    }
    // WO-464 (SDD-032): a static pattern naming a directory (e.g. "packages/core/tests", no "/**") used to
    // be treated as a single file literally named that -- `hashRef` can never read a directory as a file,
    // so it always hashed to `null`, and a "missing" governed ref only ever resolves through a commit
    // touching that exact path (`evaluateGoverned`, `monitor.ts`), which a directory can never be. Expand
    // it the way any author would expect instead of leaving it a permanently unresolvable "missing".
    const dynamic = isDynamicPattern(rel);
    const isStaticDir = !dynamic && (await isDirectory(root, rel));
    const files =
      dynamic || isStaticDir
        ? (
            await glob(isStaticDir ? `${rel}/**` : rel, {
              cwd: root,
              ignore: effectiveIgnore,
              onlyFiles: true,
              dot: false,
              followSymbolicLinks: false,
              expandDirectories: false,
            })
          ).sort()
        : [rel];
    if (files.length === 0) warnings.push(`impacts_paths pattern "${pattern}" matches no files`);

    for (const path of files) {
      const key = symbol ? `${path}#${symbol}` : path;
      if (refs.has(key)) continue;
      const extractor = options.extractor ?? (await defaultExtractorFor(symbol));
      const { hash, warning } = await hashRef(root, key, path, symbol, extractor, options.cache);
      if (warning) warnings.push(warning);
      refs.set(key, { key, path, symbol, hash });
    }
  }
  return { refs: [...refs.values()], warnings };
}

async function hashRef(
  root: string,
  key: string,
  path: string,
  symbol: string | null,
  extractor: SymbolExtractor | null,
  cache: SymbolCache | undefined,
): Promise<{ hash: string | null; warning?: string }> {
  let content: string | null;
  try {
    content = await safeReadFile(root, path);
  } catch (err) {
    return { hash: null, warning: `governed path "${path}" was not hashed: ${(err as Error).message}` };
  }
  if (content === null) return { hash: null };
  if (!symbol) return { hash: sha256(normalizeText(content)) };
  if (!extractor) return { hash: null }; // unreachable: resolveGoverned always resolves an extractor when symbol is set

  const fileHash = sha256(content);
  const cached = cache?.get(key, fileHash);
  if (cached !== undefined) return { hash: cached };
  const text = extractor.extract(content, symbol, path);
  if (text === null) return { hash: null }; // never cached: a transient miss (e.g. mid-rename) shouldn't stick
  const hash = sha256(text);
  cache?.set(key, fileHash, hash);
  return { hash };
}
