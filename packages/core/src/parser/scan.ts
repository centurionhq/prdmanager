import fg from 'fast-glob';
import { ID_PATTERN, type ParsedDoc } from '../domain/schema.js';
import { findNestedProjectRoots } from '../project/discover.js';
import { safeReadFile } from '../util/safe-fs.js';
import { parseDocument } from './frontmatter.js';

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface ScanError {
  path: string;
  error: string;
}

export interface ScanResult {
  docs: ParsedDoc[];
  errors: ScanError[];
  ids: string[];
}

const FRONTMATTER_ID_LINE = /^id:\s*"?'?([^"'\s]+)"?'?\s*$/;

/** Linear, anchored scan of the frontmatter block for an `id:` line, independent of YAML validity, so ids of files that fail validation (or duplicate) are still reserved. */
function extractFrontmatterId(content: string): string | null {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 4);
  const block = end === -1 ? normalized.slice(4) : normalized.slice(4, end);
  for (const line of block.split('\n')) {
    const candidate = FRONTMATTER_ID_LINE.exec(line)?.[1];
    if (candidate && ID_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

export interface ScannedFile {
  path: string;
  content: string;
}

/**
 * Pure core of `scanDocuments` (WO-123/SDD-007): given already-read file contents (no filesystem access), parses
 * each one, collects every frontmatter id (even from documents that fail validation or duplicate, for
 * id-reservation purposes) and reports duplicates. Callers own reading the files in whatever order they must be
 * reported in: this function preserves `files`' order for `docs` and `ids`.
 */
export function scanContents(files: readonly ScannedFile[]): ScanResult {
  const docs: ParsedDoc[] = [];
  const errors: ScanError[] = [];
  const ids: string[] = [];
  const seen = new Map<string, string>();

  for (const { path: rel, content } of files) {
    const frontmatterId = extractFrontmatterId(content);
    if (frontmatterId) ids.push(frontmatterId);

    const result = parseDocument(content, rel);
    if (result === null) continue;
    if (!result.ok) {
      errors.push({ path: result.path, error: result.error });
      continue;
    }
    const firstPath = seen.get(result.doc.node.id);
    if (firstPath) {
      errors.push({ path: rel, error: `duplicate id ${result.doc.node.id} (already defined in ${firstPath})` });
      continue;
    }
    seen.set(result.doc.node.id, rel);
    docs.push(result.doc);
  }
  return { docs, errors, ids };
}

/** A subdirectory with its own `.prdm.yaml` is a separate project (SDD-002 "Proyecto activo") and is excluded here in full. */
export async function scanDocuments(root: string, ignore: string[]): Promise<ScanResult> {
  const nestedRoots = await findNestedProjectRoots(root, ignore);
  const effectiveIgnore = [...ignore, ...nestedRoots.map((rel) => `${rel}/**`)];
  const files = (await fg.glob('**/*.md', { cwd: root, ignore: effectiveIgnore, onlyFiles: true, dot: false, followSymbolicLinks: false })).sort();

  const readable: ScannedFile[] = [];
  const readErrors = new Map<string, string>();
  for (const rel of files) {
    let content: string | null;
    try {
      content = await safeReadFile(root, rel, { maxBytes: MAX_DOCUMENT_BYTES });
    } catch (err) {
      readErrors.set(rel, (err as Error).message);
      continue;
    }
    if (content === null) continue;
    readable.push({ path: rel, content });
  }

  const scanned = scanContents(readable);
  // Merged back into `files`' original order so the combined errors array is identical to the pre-WO-123 single loop.
  const parseErrors = new Map(scanned.errors.map((e) => [e.path, e.error]));
  const errors: ScanError[] = [];
  for (const rel of files) {
    const readError = readErrors.get(rel);
    if (readError !== undefined) errors.push({ path: rel, error: readError });
    else {
      const parseError = parseErrors.get(rel);
      if (parseError !== undefined) errors.push({ path: rel, error: parseError });
    }
  }
  return { docs: scanned.docs, errors, ids: scanned.ids };
}
