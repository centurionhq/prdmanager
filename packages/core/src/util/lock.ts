import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { safeReadFile, safeWriteFile } from './safe-fs.js';

export const LOCK_PATH = '.prdm/engine.lock';
const STALE_AFTER_MS = 10 * 60 * 1000;
const RETRY_MS = 50;

interface LockOwner {
  pid: number;
  host?: string;
  createdAt: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function isStale(root: string): Promise<boolean> {
  let owner: LockOwner;
  try {
    owner = JSON.parse((await safeReadFile(root, LOCK_PATH)) ?? 'null') as LockOwner;
  } catch {
    return true;
  }
  if (!owner || typeof owner.pid !== 'number') return true;
  const age = Date.now() - Date.parse(owner.createdAt);
  const sameHost = !owner.host || owner.host === hostname();
  return !(age < STALE_AFTER_MS) || (sameHost && !processAlive(owner.pid));
}

async function tryAcquire(root: string): Promise<boolean> {
  const owner: LockOwner = { pid: process.pid, host: hostname(), createdAt: new Date().toISOString() };
  try {
    await safeWriteFile(root, LOCK_PATH, JSON.stringify(owner), { exclusive: true });
    return true;
  } catch (err) {
    if (!/already exists/.test((err as Error).message)) throw err;
    if (await isStale(root)) await fs.rm(join(root, LOCK_PATH), { force: true });
    return false;
  }
}

/** Cross-process mutex for engine mutations (CLI, git hook, watch and MCP server may run at the same time). */
export async function withRepoLock<T>(root: string, fn: () => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  while (!(await tryAcquire(root))) {
    if (Date.now() > deadline) throw new Error(`another prdm process holds ${LOCK_PATH}; retry later or remove the lock if no prdm process is running`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  try {
    return await fn();
  } finally {
    await fs.rm(join(root, LOCK_PATH), { force: true });
  }
}
