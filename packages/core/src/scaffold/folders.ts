import { DOC_KINDS, type DocKind } from '../domain/schema.js';
import { DEFAULT_FOLDERS, type FolderMap } from '../project/types.js';

const DEFAULT_DOCS_DIR = 'docs';

/** Remaps {@link DEFAULT_FOLDERS} (all rooted at `docs/`) onto a custom `docsDir`, e.g. for `--adopt`. */
export function foldersForDocsDir(docsDir: string): FolderMap {
  if (docsDir === DEFAULT_DOCS_DIR) return DEFAULT_FOLDERS;
  const entries = DOC_KINDS.map((kind): [DocKind, string] => {
    const suffix = DEFAULT_FOLDERS[kind].slice(`${DEFAULT_DOCS_DIR}/`.length);
    return [kind, `${docsDir}/${suffix}`];
  });
  return Object.fromEntries(entries) as FolderMap;
}
