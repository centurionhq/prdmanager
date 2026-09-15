/**
 * `source_path` normalization for `POST .../import` (SDD-010 "Importador", WO-192): every imported
 * document's path must land inside `<folder for its kind>/<its own id>*.md` — never trusted verbatim
 * from the client, and never "fixed up" into shape either; a path that doesn't already fit is rejected
 * outright, together with the whole import (SDD-010: "el servidor re-valida todo").
 *
 * Reuses the same traversal-safety primitives as `util/paths.ts`'s `resolveInside` (no NUL bytes, no
 * backslashes, no absolute paths, no `.`/`..` segments) rather than a filesystem check — this never
 * touches disk (a document's `source_path` here is a plain Postgres text column, not a real file), so
 * there is no symlink to follow; the traversal guard exists purely so a crafted `source_path` can never
 * misrepresent itself to a later consumer that *does* build a filesystem path from it.
 */
import type { DocKind } from '../domain/schema.js';
import type { FolderMap } from '../project/types.js';

export class UnsafeImportSourcePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeImportSourcePathError';
  }
}

function assertSafeRelativePath(id: string, path: string): void {
  if (path.includes('\0')) throw new UnsafeImportSourcePathError(`${id}: source_path must not contain NUL bytes`);
  if (path.includes('\\')) throw new UnsafeImportSourcePathError(`${id}: source_path must use forward slashes`);
  if (path.startsWith('/')) throw new UnsafeImportSourcePathError(`${id}: source_path must be a relative path`);
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new UnsafeImportSourcePathError(`${id}: source_path must not contain "." or ".." segments`);
  }
}

/**
 * Throws `UnsafeImportSourcePathError` unless `requestedPath` is exactly `<folders[kind]>/<basename>`
 * with `basename` starting with `id` and ending in `.md`, and no subdirectory beneath `folders[kind]`.
 */
export function assertSafeImportSourcePath(kind: DocKind, id: string, folders: FolderMap, requestedPath: string): void {
  assertSafeRelativePath(id, requestedPath);

  const folder = folders[kind];
  const prefix = `${folder}/`;
  if (!requestedPath.startsWith(prefix)) {
    throw new UnsafeImportSourcePathError(`${id}: source_path must be inside "${folder}" (its kind's folder), got "${requestedPath}"`);
  }
  const basename = requestedPath.slice(prefix.length);
  if (basename.length === 0 || basename.includes('/')) {
    throw new UnsafeImportSourcePathError(`${id}: source_path must be directly inside "${folder}" (no subdirectories)`);
  }
  if (!basename.startsWith(id)) {
    throw new UnsafeImportSourcePathError(`${id}: source_path's file name must start with "${id}", got "${basename}"`);
  }
  if (!basename.endsWith('.md')) {
    throw new UnsafeImportSourcePathError(`${id}: source_path must end with ".md"`);
  }
}
