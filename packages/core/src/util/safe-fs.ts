import { constants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, relative } from 'node:path';
import { resolveInside } from './paths.js';

export const DEFAULT_MAX_READ_BYTES = 2 * 1024 * 1024;

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const isErrno = (err: unknown, code: string): boolean => (err as NodeJS.ErrnoException | undefined)?.code === code;

/** Resolves the closest existing ancestor (lstat, so dangling links count as existing) and requires its realpath to stay inside root. */
async function assertRealDirInside(realRoot: string, absDir: string, rel: string): Promise<void> {
  let current = absDir;
  for (;;) {
    try {
      await fs.lstat(current);
      break;
    } catch (err) {
      if (!isErrno(err, 'ENOENT')) throw err;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  let real: string;
  try {
    real = await fs.realpath(current);
  } catch {
    throw new Error(`refusing to write ${rel}: a dangling symlink is in its path`);
  }
  if (!isWithin(realRoot, real)) throw new Error(`refusing to write ${rel}: its directory resolves through a symlink outside the repository`);
}

/** Writes a file inside root without following symlinks out of the repository (directories via realpath, final component via O_NOFOLLOW). */
export async function safeWriteFile(root: string, relPath: string, content: string, options: { exclusive?: boolean } = {}): Promise<void> {
  const { abs, rel } = resolveInside(root, relPath);
  const realRoot = await fs.realpath(root);
  await assertRealDirInside(realRoot, dirname(abs), rel);
  await fs.mkdir(dirname(abs), { recursive: true });
  await assertRealDirInside(realRoot, dirname(abs), rel);

  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (options.exclusive ? constants.O_EXCL : constants.O_TRUNC);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(abs, flags, 0o644);
  } catch (err) {
    if (isErrno(err, 'ELOOP')) throw new Error(`refusing to write ${rel}: it is a symlink`);
    if (isErrno(err, 'EEXIST')) throw new Error(`${rel} already exists`);
    throw err;
  }
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

/** Reads a regular file whose realpath is inside root; returns null when it does not exist. */
export async function safeReadFile(root: string, relPath: string, options: { maxBytes?: number } = {}): Promise<string | null> {
  const { abs, rel } = resolveInside(root, relPath);
  const realRoot = await fs.realpath(root);
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return null;
    throw err;
  }
  if (!isWithin(realRoot, real)) throw new Error(`refusing to read ${rel}: it resolves outside the repository`);
  const stats = await fs.stat(real);
  if (!stats.isFile()) throw new Error(`refusing to read ${rel}: not a regular file`);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  if (stats.size > maxBytes) throw new Error(`refusing to read ${rel}: size exceeds ${maxBytes} bytes`);
  return fs.readFile(real, 'utf8');
}
