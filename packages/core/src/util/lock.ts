import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { safeCreateAtomic, safeReadFile, safeReplaceAtomic } from './safe-fs.js';

export const LOCK_PATH = '.prdm/engine.lock';
const DEFAULT_HEARTBEAT_MS = 5_000;
/** Generous: a live owner only ever goes this long without refreshing under normal scheduling; past it we assume it crashed without cleaning up. */
const DEFAULT_STALE_AFTER_MS = 2 * 60 * 1000;
const RETRY_MS = 50;
/** Small allowance for clock drift between the moment `heartbeatAt`/`createdAt` was written and read back. */
const CLOCK_SKEW_TOLERANCE_MS = 5_000;

interface LockOwner {
  token?: string;
  pid: number;
  host?: string;
  createdAt: string;
  heartbeatAt?: string;
}

export interface RepoLockOptions {
  timeoutMs?: number;
  /** How often the held lock's heartbeat is refreshed on disk; overridable so tests don't wait minutes. */
  heartbeatMs?: number;
  /** How stale (no heartbeat) a lock must be, on top of a dead pid, before it is considered abandoned. */
  staleAfterMs?: number;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const isErrno = (err: unknown, code: string): boolean => (err as NodeJS.ErrnoException | undefined)?.code === code;

function parseOwner(raw: string): LockOwner | null {
  try {
    const owner = JSON.parse(raw) as Partial<LockOwner>;
    if (typeof owner.pid !== 'number' || typeof owner.createdAt !== 'string') return null;
    return owner as LockOwner;
  } catch {
    return null;
  }
}

async function readOwnerAt(root: string, relPath: string): Promise<LockOwner | null> {
  let raw: string | null;
  try {
    raw = await safeReadFile(root, relPath);
  } catch {
    return null;
  }
  return raw === null ? null : parseOwner(raw);
}

async function mtimeOf(root: string, relPath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(join(root, relPath));
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * A lock is stale once its last known activity is older than `staleAfterMs`. "Last known activity" is the
 * owner's `heartbeatAt`/`createdAt` when that timestamp is well-formed and not in the future (a healthy clock
 * never reports a heartbeat ahead of now); otherwise (unparsable/empty content, or a bogus/far-future
 * timestamp) it falls back to the lock file's own mtime, so neither a corrupt lock nor a spoofed heartbeat can
 * make a lock immortal or instantly stealable (WO-023 finding 3).
 */
async function isStale(root: string, owner: LockOwner | null, staleAfterMs: number): Promise<boolean> {
  if (owner) {
    const sameHost = !owner.host || owner.host === hostname();
    if (sameHost && !processAlive(owner.pid)) return true;
    const lastSeen = Date.parse(owner.heartbeatAt ?? owner.createdAt);
    if (Number.isFinite(lastSeen) && lastSeen <= Date.now() + CLOCK_SKEW_TOLERANCE_MS) {
      return Date.now() - lastSeen > staleAfterMs;
    }
  }
  const mtime = await mtimeOf(root, LOCK_PATH);
  if (mtime === null) return true;
  return Date.now() - mtime > staleAfterMs;
}

/**
 * Moves a lock file judged stale out of the way atomically, re-reads what actually got moved, and only deletes
 * it once its owner token matches the one just judged stale — protecting against a lock that was refreshed or
 * replaced by a new owner in the window between the staleness check and the break (WO-023 finding 3).
 */
async function breakIfStale(root: string, judgedStaleOwner: LockOwner | null): Promise<void> {
  const quarantine = join(root, '.prdm', `lock.stale-${randomBytes(8).toString('hex')}`);
  const lockAbs = join(root, LOCK_PATH);
  try {
    await fs.rename(lockAbs, quarantine);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return;
    throw err;
  }
  let movedRaw: string | null = null;
  try {
    movedRaw = await fs.readFile(quarantine, 'utf8');
  } catch {
    /* moved file vanished; nothing to restore */
  }
  const moved = movedRaw === null ? null : parseOwner(movedRaw);
  const sameOwner = (moved?.token ?? null) === (judgedStaleOwner?.token ?? null) && (moved?.pid ?? null) === (judgedStaleOwner?.pid ?? null);
  if (sameOwner) {
    await fs.unlink(quarantine).catch(() => undefined);
  } else {
    // Someone else refreshed or replaced the lock between our check and the break: put it back untouched.
    await fs.rename(quarantine, lockAbs).catch(() => undefined);
  }
}

async function tryAcquire(root: string, token: string, staleAfterMs: number): Promise<boolean> {
  const now = new Date().toISOString();
  const owner: LockOwner = { token, pid: process.pid, host: hostname(), createdAt: now, heartbeatAt: now };
  try {
    // Write-temp-then-link is atomic even on filesystems (e.g. NFS) where O_EXCL create is not reliable.
    await safeCreateAtomic(root, LOCK_PATH, JSON.stringify(owner));
    return true;
  } catch (err) {
    if (!/already exists/.test((err as Error).message)) throw err;
    const existing = await readOwnerAt(root, LOCK_PATH);
    if (await isStale(root, existing, staleAfterMs)) await breakIfStale(root, existing);
    return false;
  }
}

async function heartbeat(root: string, token: string): Promise<void> {
  const existing = await readOwnerAt(root, LOCK_PATH);
  if (!existing || existing.token !== token) return;
  const updated: LockOwner = { ...existing, heartbeatAt: new Date().toISOString() };
  await safeReplaceAtomic(root, LOCK_PATH, JSON.stringify(updated));
}

/** Removes the lock only if it is still ours (read-compare-remove); tolerates it already being gone or stolen. */
async function release(root: string, token: string): Promise<void> {
  const existing = await readOwnerAt(root, LOCK_PATH);
  if (!existing || existing.token !== token) return;
  await fs.rm(join(root, LOCK_PATH), { force: true });
}

/** Cross-process mutex for engine mutations (CLI, git hook, watch and MCP server may run at the same time). */
export async function withRepoLock<T>(root: string, fn: () => Promise<T>, options: RepoLockOptions = {}): Promise<T> {
  const token = randomBytes(16).toString('hex');
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  while (!(await tryAcquire(root, token, staleAfterMs))) {
    if (Date.now() > deadline) throw new Error(`another prdm process holds ${LOCK_PATH}; retry later or remove the lock if no prdm process is running`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  const timer = setInterval(() => {
    heartbeat(root, token).catch(() => undefined);
  }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  timer.unref();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    await release(root, token);
  }
}
