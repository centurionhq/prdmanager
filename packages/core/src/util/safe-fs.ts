import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
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

/** fsyncs a directory so a preceding link/rename/unlink within it survives a crash. */
async function fsyncDir(dir: string): Promise<void> {
  const handle = await fs.open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Writes `content` to a same-directory temp file, fsyncs it, then publishes it via `publish` and fsyncs the directory. */
async function writeTempThen(root: string, relPath: string, content: string, publish: (tempPath: string, abs: string) => Promise<void>): Promise<string> {
  const { abs, rel } = resolveInside(root, relPath);
  const realRoot = await fs.realpath(root);
  const dir = dirname(abs);
  await assertRealDirInside(realRoot, dir, rel);
  await fs.mkdir(dir, { recursive: true });
  await assertRealDirInside(realRoot, dir, rel);

  const tempPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
  const handle = await fs.open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await publish(tempPath, abs);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw err;
  }
  await fsyncDir(dir);
  return rel;
}

/**
 * Creates a new file durably: writes+fsyncs a temp file, then publishes it with `link` (fails if the target
 * already exists, unlike `rename`), unlinks the temp name and fsyncs the directory. Never partially overwrites
 * an existing file, so a crash mid-publish leaves either nothing or the temp file (both harmless, both cleaned
 * up by the caller's journal on replay).
 */
export async function safeCreateAtomic(root: string, relPath: string, content: string): Promise<void> {
  await writeTempThen(root, relPath, content, async (tempPath, abs) => {
    try {
      await fs.link(tempPath, abs);
    } catch (err) {
      if (isErrno(err, 'EEXIST')) throw new Error(`${relative(root, abs)} already exists`);
      throw err;
    }
    await fs.unlink(tempPath);
  });
}

/**
 * Replaces an existing (or absent) file durably: writes+fsyncs a temp file, then `rename`s it over the target
 * (atomic within the same filesystem) and fsyncs the directory.
 */
export async function safeReplaceAtomic(root: string, relPath: string, content: string): Promise<void> {
  await writeTempThen(root, relPath, content, async (tempPath, abs) => {
    await fs.rename(tempPath, abs);
  });
}

/** Removes a file inside root if it exists (realpath-checked); a no-op when it is already absent. */
export async function safeUnlink(root: string, relPath: string): Promise<void> {
  const { abs, rel } = resolveInside(root, relPath);
  const realRoot = await fs.realpath(root);
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return;
    throw err;
  }
  if (!isWithin(realRoot, real)) throw new Error(`refusing to remove ${rel}: it resolves outside the repository`);
  await fs.unlink(abs);
  await fsyncDir(dirname(abs)).catch(() => undefined);
}
