import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import type { ParsedDoc } from '../domain/schema.js';
import { parseDocument } from './frontmatter.js';

export interface ScanError {
  path: string;
  error: string;
}

export interface ScanResult {
  docs: ParsedDoc[];
  errors: ScanError[];
}

export async function scanDocuments(root: string, ignore: string[]): Promise<ScanResult> {
  const files = (await fg.glob('**/*.md', { cwd: root, ignore, onlyFiles: true, dot: false, followSymbolicLinks: false })).sort();
  const docs: ParsedDoc[] = [];
  const errors: ScanError[] = [];
  const seen = new Map<string, string>();

  for (const rel of files) {
    const result = parseDocument(await readFile(join(root, rel), 'utf8'), rel);
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
  return { docs, errors };
}
