import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { safeCreateAtomic, safeReadFile, safeReplaceAtomic, safeUnlink } from './safe-fs.js';

export const JOURNAL_DIR = '.prdm';
export const GRAPH_STALE_PATH = '.prdm/graph-stale';

export interface JournalEntry {
  path: string;
  kind: 'created' | 'replaced';
  /** base64-encoded pre-image; present only for `replaced` entries. */
  original?: string;
}

export interface JournalOwner {
  token: string;
  pid: number;
  host: string;
}

export interface Journal {
  owner: JournalOwner;
  entries: JournalEntry[];
}

const journalRelPath = (token: string): string => `${JOURNAL_DIR}/journal-${token}.json`;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Full rewrite + fsync of the journal file itself, so an entry is durable before the mutation it guards begins. */
async function writeJournalFile(root: string, token: string, journal: Journal): Promise<void> {
  const abs = join(root, journalRelPath(token));
  await fs.mkdir(dirname(abs), { recursive: true });
  const handle = await fs.open(abs, 'w');
  try {
    await handle.writeFile(JSON.stringify(journal), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJournalFile(root: string, token: string): Promise<Journal | null> {
  const raw = await safeReadFile(root, journalRelPath(token));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Journal;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries) || !parsed.owner) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Opens a new journal for the current process; returns its token. Call before any journaled mutation. */
export async function createJournal(root: string): Promise<string> {
  const token = randomBytes(16).toString('hex');
  await writeJournalFile(root, token, { owner: { token, pid: process.pid, host: hostname() }, entries: [] });
  return token;
}

async function appendEntry(root: string, token: string, entry: JournalEntry): Promise<void> {
  const journal = await readJournalFile(root, token);
  if (!journal) throw new Error(`journal ${token} not found (was it already closed?)`);
  await writeJournalFile(root, token, { ...journal, entries: [...journal.entries, entry] });
}

/** Records a pending file creation (fsynced) and then creates it durably. */
export async function journalCreate(root: string, token: string, rel: string, content: string): Promise<void> {
  await appendEntry(root, token, { path: rel, kind: 'created' });
  await safeCreateAtomic(root, rel, content);
}

/** Records a pending file replacement together with its pre-image (fsynced) and then replaces it durably. */
export async function journalReplace(root: string, token: string, rel: string, original: string, content: string): Promise<void> {
  await appendEntry(root, token, { path: rel, kind: 'replaced', original: Buffer.from(original, 'utf8').toString('base64') });
  await safeReplaceAtomic(root, rel, content);
}

/** Closes a journal successfully (its mutations are kept); safe to call even if the file is already gone. */
export async function deleteJournal(root: string, token: string): Promise<void> {
  await safeUnlink(root, journalRelPath(token));
}

/** Restores every entry of `token`'s journal in reverse order, then deletes the journal. A no-op if it is already gone. */
export async function rollback(root: string, token: string): Promise<void> {
  const journal = await readJournalFile(root, token);
  if (journal) {
    for (const entry of [...journal.entries].reverse()) {
      if (entry.kind === 'created') {
        await safeUnlink(root, entry.path);
      } else {
        const original = Buffer.from(entry.original ?? '', 'base64').toString('utf8');
        await safeReplaceAtomic(root, entry.path, original);
      }
    }
  }
  await deleteJournal(root, token);
}

export async function writeGraphStaleMarker(root: string): Promise<void> {
  const abs = join(root, GRAPH_STALE_PATH);
  await fs.mkdir(dirname(abs), { recursive: true });
  const handle = await fs.open(abs, 'w');
  try {
    await handle.writeFile(new Date().toISOString(), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function graphStaleMarkerExists(root: string): Promise<boolean> {
  return (await safeReadFile(root, GRAPH_STALE_PATH)) !== null;
}

export async function removeGraphStaleMarker(root: string): Promise<void> {
  await safeUnlink(root, GRAPH_STALE_PATH);
}

/**
 * Rolls back and marks the graph stale for every journal left behind by a process confirmed dead (same host,
 * pid no longer alive). Journals of a still-live owner, or of a foreign host whose liveness can't be checked,
 * are left untouched — a live owner is the one responsible for finishing or rolling back its own journal.
 */
export async function replayOrphanJournals(root: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(join(root, JOURNAL_DIR));
  } catch {
    return;
  }
  const tokens = names.filter((n) => n.startsWith('journal-') && n.endsWith('.json')).map((n) => n.slice('journal-'.length, -'.json'.length));
  for (const token of tokens) {
    const journal = await readJournalFile(root, token);
    if (!journal) continue;
    const sameHost = journal.owner.host === hostname();
    const dead = sameHost && !processAlive(journal.owner.pid);
    if (!dead) continue;
    await rollback(root, token);
    await writeGraphStaleMarker(root);
  }
}
