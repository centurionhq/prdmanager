import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface ResolvedPath {
  abs: string;
  rel: string;
}

/**
 * Resolves a repository-relative path and refuses anything that escapes the root (path traversal guard).
 * Requires `root` itself to already be an absolute path (WO-124/SDD-007): a future SaaS pseudo-root like
 * `saas://project/<uuid>` must never silently resolve against `process.cwd()` and reach a real fs call.
 */
export function resolveInside(root: string, relPath: string): ResolvedPath {
  if (!isAbsolute(root)) throw new Error(`root must be an absolute path, got: ${JSON.stringify(root)}`);
  if (!relPath || relPath.includes('\0')) throw new Error(`invalid path: ${JSON.stringify(relPath)}`);
  if (isAbsolute(relPath)) throw new Error(`path is outside the repository: ${relPath}`);
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, relPath);
  const rel = relative(rootAbs, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path is outside the repository: ${relPath}`);
  return { abs, rel: rel.split(sep).join('/') };
}
