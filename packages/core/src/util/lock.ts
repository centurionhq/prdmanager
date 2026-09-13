import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { safeReadFile, safeWriteFile } from './safe-fs.js';

export const LOCK_PATH = '.prdm/engine.lock';
const DEFAULT_HEARTBEAT_MS = 5_000;
/** Generous: a live owner only ever goes this long without refreshing under normal scheduling; past it we assume it crashed without cleaning up. */
const DEFAULT_STALE_AFTER_MS = 2 * 60 * 1000;
const RETRY_MS = 50;

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

async function readOwner(root: string): Promise<LockOwner | null> {
  let raw: string | null;
  try {
    raw = await safeReadFile(root, LOCK_PATH);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const owner = JSON.parse(raw) as Partial<LockOwner>;
    if (typeof owner.pid !== 'number' || typeof owner.createdAt !== 'string') return null;
    return owner as LockOwner;
  } catch {
    return null;
  }
}

/**
 * A lock is only ever broken when its owner is verifiably gone: same host and a dead pid (a foreign host's
 * liveness can't be checked, so it is trusted), or its heartbeat has not been refreshed for `staleAfterMs`
 * (covers a crash that leaves the pid recycled to a different, unrelated live process).
 */
function isStale(owner: LockOwner | null, staleAfterMs: number): boolean {
  if (!owner) return true;
  const sameHost = !owner.host || owner.host === hostname();
  if (sameHost && !processAlive(owner.pid)) return true;
  const lastSeen = Date.parse(owner.heartbeatAt ?? owner.createdAt);
  return Date.now() - lastSeen > staleAfterMs;
}

async function tryAcquire(root: string, token: string, staleAfterMs: number): Promise<boolean> {
  const now = new Date().toISOString();
  const owner: LockOwner = { token, pid: process.pid, host: hostname(), createdAt: now, heartbeatAt: now };
  try {
    await safeWriteFile(root, LOCK_PATH, JSON.stringify(owner), { exclusive: true });
    return true;
  } catch (err) {
    if (!/already exists/.test((err as Error).message)) throw err;
    const existing = await readOwner(root);
    if (isStale(existing, staleAfterMs)) await fs.rm(join(root, LOCK_PATH), { force: true });
    return false;
  }
}

async function heartbeat(root: string, token: string): Promise<void> {
  const existing = await readOwner(root);
  if (!existing || existing.token !== token) return;
  const updated: LockOwner = { ...existing, heartbeatAt: new Date().toISOString() };
  await safeWriteFile(root, LOCK_PATH, JSON.stringify(updated));
}

/** Removes the lock only if it is still ours (read-compare-remove); tolerates it already being gone or stolen. */
async function release(root: string, token: string): Promise<void> {
  const existing = await readOwner(root);
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
