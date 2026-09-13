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

/** A subdirectory with its own `.prdm.yaml` is a separate project (SDD-002 "Proyecto activo") and is excluded here in full. */
export async function scanDocuments(root: string, ignore: string[]): Promise<ScanResult> {
  const nestedRoots = await findNestedProjectRoots(root, ignore);
  const effectiveIgnore = [...ignore, ...nestedRoots.map((rel) => `${rel}/**`)];
  const files = (await fg.glob('**/*.md', { cwd: root, ignore: effectiveIgnore, onlyFiles: true, dot: false, followSymbolicLinks: false })).sort();
  const docs: ParsedDoc[] = [];
  const errors: ScanError[] = [];
  const ids: string[] = [];
  const seen = new Map<string, string>();

  for (const rel of files) {
    let content: string | null;
    try {
      content = await safeReadFile(root, rel, { maxBytes: MAX_DOCUMENT_BYTES });
    } catch (err) {
      errors.push({ path: rel, error: (err as Error).message });
      continue;
    }
    if (content === null) continue;
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
