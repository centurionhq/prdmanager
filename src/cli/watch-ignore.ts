import { relative, sep } from 'node:path';
import picomatch from 'picomatch';

const DEFAULT_IGNORE = ['.git/**', '.prdm/**', 'node_modules/**'];

/** chokidar 5 treats string `ignored` entries as exact paths, not globs; build a matcher function instead. */
export function createIgnoreMatcher(root: string, globs: readonly string[]): (absPath: string) => boolean {
  const isMatch = picomatch([...DEFAULT_IGNORE, ...globs], { dot: true });
  return (absPath: string): boolean => {
    const rel = relative(root, absPath).split(sep).join('/');
    if (rel === '') return false;
    if (rel.startsWith('..')) return true;
    return isMatch(rel);
  };
}
