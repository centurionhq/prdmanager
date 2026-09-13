import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface ResolvedPath {
  abs: string;
  rel: string;
}

/** Resolves a repository-relative path and refuses anything that escapes the root (path traversal guard). */
export function resolveInside(root: string, relPath: string): ResolvedPath {
  if (!relPath || relPath.includes('\0')) throw new Error(`invalid path: ${JSON.stringify(relPath)}`);
  if (isAbsolute(relPath)) throw new Error(`path is outside the repository: ${relPath}`);
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, relPath);
  const rel = relative(rootAbs, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path is outside the repository: ${relPath}`);
  return { abs, rel: rel.split(sep).join('/') };
}
