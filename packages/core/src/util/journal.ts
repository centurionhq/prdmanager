import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256 } from './hash.js';
import { safeCreateAtomic, safeReadFile, safeReplaceAtomic, safeUnlink } from './safe-fs.js';

export const JOURNAL_DIR = '.prdm';
export const GRAPH_STALE_PATH = '.prdm/graph-stale';

/** Journals can hold several documents' worth of pre/post-image content; the generic safe-fs default (2 MiB) is too small. */
const JOURNAL_MAX_READ_BYTES = 64 * 1024 * 1024;

export interface JournalEntry {
  path: string;
  kind: 'created' | 'replaced';
  /** sha256 of the content this entry's mutation wrote; rollback only acts when the file's current content still matches. */
  sha256: string;
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

export interface RecoveryResult {
  /** Tokens whose journal was authenticated and rolled back. */
  rolledBack: string[];
  /** Human-readable warnings: unsigned/malformed journals (never touched) and entries skipped during rollback. */
  warnings: string[];
}

const journalRelPath = (token: string): string => `${JOURNAL_DIR}/journal-${token}.json`;

/** Where the per-user HMAC key lives: outside the repository, so a cloned/checked-out repo can never carry a key that would let it forge journals. */
function journalKeyPath(env: NodeJS.ProcessEnv): string {
  if (env.PRDM_JOURNAL_KEY_FILE) return env.PRDM_JOURNAL_KEY_FILE;
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'prdm', 'journal.key');
}

const isErrno = (err: unknown, code: string): boolean => (err as NodeJS.ErrnoException | undefined)?.code === code;

/** Reads the per-user journal signing key, generating a fresh 32-byte one (mode 0600) on first use. Never stored inside the repo. */
async function getJournalKey(env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const keyPath = journalKeyPath(env);
  try {
    const existing = await fs.readFile(keyPath);
    if (existing.length >= 32) return existing;
  } catch (err) {
    if (!isErrno(err, 'ENOENT')) throw err;
  }
  await fs.mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  try {
    await fs.writeFile(keyPath, key, { flag: 'wx', mode: 0o600 });
    return key;
  } catch (err) {
    if (isErrno(err, 'EEXIST')) return fs.readFile(keyPath);
    throw err;
  }
}

/** Deterministic (sorted-key) JSON serialization so verification never depends on incidental key ordering from JSON.parse. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function computeMac(payload: { owner: JournalOwner; entries: JournalEntry[] }, env?: NodeJS.ProcessEnv): Promise<string> {
  const key = await getJournalKey(env);
  return createHmac('sha256', key).update(canonicalize(payload)).digest('hex');
}

function macMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Only `.md` files under `docsDir` may ever be journaled: rejects `.git/**`, `.prdm/**` and anything else, both when recording and when replaying. */
function assertDocPath(rel: string, docsDir: string): void {
  const normalizedDocsDir = docsDir.replace(/\/+$/, '');
  const prefix = `${normalizedDocsDir}/`;
  const looksSafe = rel.endsWith('.md') && rel.startsWith(prefix) && !rel.startsWith('.git/') && !rel.startsWith('.prdm/') && !rel.includes('..');
  if (!looksSafe) throw new Error(`refusing to journal ${JSON.stringify(rel)}: only .md files under ${normalizedDocsDir} may be journaled`);
}

/** Full rewrite of the journal file (temp + fsync + rename + dir fsync via safe-fs), signed with the per-user HMAC key. */
async function writeJournalFile(root: string, token: string, journal: Journal, env?: NodeJS.ProcessEnv): Promise<void> {
  const mac = await computeMac(journal, env);
  await safeReplaceAtomic(root, journalRelPath(token), JSON.stringify({ ...journal, mac }));
}

type ReadOutcome = { kind: 'ok'; journal: Journal } | { kind: 'invalid' } | { kind: 'missing' };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOwner(value: unknown): JournalOwner | null {
  if (!isPlainRecord(value)) return null;
  const { token, pid, host } = value;
  if (typeof token !== 'string' || typeof host !== 'string' || typeof pid !== 'number') return null;
  return { token, pid, host };
}

function parseEntries(value: unknown): JournalEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: JournalEntry[] = [];
  for (const raw of value) {
    if (!isPlainRecord(raw)) return null;
    const { path, kind, sha256: hash, original } = raw;
    if (typeof path !== 'string' || (kind !== 'created' && kind !== 'replaced') || typeof hash !== 'string') return null;
    if (original !== undefined && typeof original !== 'string') return null;
    entries.push({ path, kind, sha256: hash, ...(original !== undefined ? { original } : {}) });
  }
  return entries;
}

async function readJournalFile(root: string, token: string, env?: NodeJS.ProcessEnv): Promise<ReadOutcome> {
  let raw: string | null;
  try {
    raw = await safeReadFile(root, journalRelPath(token), { maxBytes: JOURNAL_MAX_READ_BYTES });
  } catch {
    return { kind: 'invalid' };
  }
  if (raw === null) return { kind: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid' };
  }
  if (!isPlainRecord(parsed) || typeof parsed.mac !== 'string') return { kind: 'invalid' };
  const owner = parseOwner(parsed.owner);
  const entries = parseEntries(parsed.entries);
  if (!owner || !entries) return { kind: 'invalid' };
  const expected = await computeMac({ owner, entries }, env);
  if (!macMatches(parsed.mac, expected)) return { kind: 'invalid' };
  return { kind: 'ok', journal: { owner, entries } };
}

/** Opens a new journal for the current process; returns its token. Call before any journaled mutation. */
export async function createJournal(root: string): Promise<string> {
  const token = randomBytes(16).toString('hex');
  await writeJournalFile(root, token, { owner: { token, pid: process.pid, host: hostname() }, entries: [] });
  return token;
}

async function appendEntry(root: string, token: string, entry: JournalEntry): Promise<void> {
  const outcome = await readJournalFile(root, token);
  if (outcome.kind !== 'ok') throw new Error(`journal ${token} not found or failed authentication (was it already closed, or tampered with?)`);
  await writeJournalFile(root, token, { ...outcome.journal, entries: [...outcome.journal.entries, entry] });
}

/**
 * Records a pending file creation (fsynced, signed) and then creates it durably. Verifies the path is absent
 * first so a failed create never journals an entry that could later cause rollback to delete a pre-existing,
 * unrelated file (WO-023 finding 2).
 */
export async function journalCreate(root: string, docsDir: string, token: string, rel: string, content: string): Promise<void> {
  assertDocPath(rel, docsDir);
  const existing = await safeReadFile(root, rel);
  if (existing !== null) throw new Error(`${rel} already exists`);
  await appendEntry(root, token, { path: rel, kind: 'created', sha256: sha256(content) });
  await safeCreateAtomic(root, rel, content);
}

/** Records a pending file replacement together with its pre-image (fsynced, signed) and then replaces it durably. */
export async function journalReplace(root: string, docsDir: string, token: string, rel: string, original: string, content: string): Promise<void> {
  assertDocPath(rel, docsDir);
  await appendEntry(root, token, { path: rel, kind: 'replaced', original: Buffer.from(original, 'utf8').toString('base64'), sha256: sha256(content) });
  await safeReplaceAtomic(root, rel, content);
}

/** Closes a journal successfully (its mutations are kept); safe to call even if the file is already gone. */
export async function deleteJournal(root: string, token: string): Promise<void> {
  await safeUnlink(root, journalRelPath(token));
}

async function rollbackEntry(root: string, docsDir: string, entry: JournalEntry, warnings: string[]): Promise<void> {
  try {
    assertDocPath(entry.path, docsDir);
  } catch {
    warnings.push(`skipped rollback of ${entry.path}: not a valid journaled document path`);
    return;
  }
  const current = await safeReadFile(root, entry.path).catch(() => null);
  const currentHash = current === null ? null : sha256(current);
  if (currentHash !== entry.sha256) {
    warnings.push(`skipped rollback of ${entry.path}: its content no longer matches what this transaction wrote (modified since, or already reverted)`);
    return;
  }
  if (entry.kind === 'created') {
    await safeUnlink(root, entry.path);
  } else {
    const original = Buffer.from(entry.original ?? '', 'base64').toString('utf8');
    await safeReplaceAtomic(root, entry.path, original);
  }
}

/**
 * Restores every entry of `token`'s journal in reverse order, then deletes the journal. A no-op if it is
 * already gone. An unsigned/malformed journal is never rolled back (and never deleted): it is left in place and
 * reported as a warning, since replaying it could not be authenticated as ours (WO-023 finding 1).
 */
export async function rollback(root: string, docsDir: string, token: string): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const outcome = await readJournalFile(root, token);
  if (outcome.kind === 'invalid') {
    warnings.push(`journal ${token} is unsigned or malformed; leaving it in place rather than risk replaying an unauthenticated mutation`);
    return { warnings };
  }
  if (outcome.kind === 'ok') {
    for (const entry of [...outcome.journal.entries].reverse()) {
      await rollbackEntry(root, docsDir, entry, warnings);
    }
  }
  await deleteJournal(root, token);
  return { warnings };
}

export async function writeGraphStaleMarker(root: string): Promise<void> {
  await safeReplaceAtomic(root, GRAPH_STALE_PATH, new Date().toISOString());
}

export async function graphStaleMarkerExists(root: string): Promise<boolean> {
  return (await safeReadFile(root, GRAPH_STALE_PATH)) !== null;
}

export async function removeGraphStaleMarker(root: string): Promise<void> {
  await safeUnlink(root, GRAPH_STALE_PATH);
}

/**
 * Rolls back every authenticated journal found in `.prdm`. Callers MUST hold the repo lock (`withRepoLock`)
 * while calling this: that exclusivity is exactly what makes it safe to treat every journal found here as
 * orphaned, regardless of whose pid wrote it (WO-023 finding 4) — no other process can be mid-transaction while
 * we hold the lock, and this function only ever runs before this transaction creates its own journal. A journal
 * that fails HMAC authentication (planted, corrupted, or written without the per-user key) is never replayed;
 * it is left in place and reported as a warning instead.
 */
export async function replayOrphanJournals(root: string, docsDir: string): Promise<RecoveryResult> {
  let names: string[];
  try {
    names = await fs.readdir(join(root, JOURNAL_DIR));
  } catch {
    return { rolledBack: [], warnings: [] };
  }
  const tokens = names.filter((n) => n.startsWith('journal-') && n.endsWith('.json')).map((n) => n.slice('journal-'.length, -'.json'.length));
  const rolledBack: string[] = [];
  const warnings: string[] = [];
  for (const token of tokens) {
    const outcome = await readJournalFile(root, token);
    if (outcome.kind === 'missing') continue;
    if (outcome.kind === 'invalid') {
      warnings.push(`journal ${token} is unsigned or malformed; leaving it in place`);
      continue;
    }
    if (!Number.isInteger(outcome.journal.owner.pid) || outcome.journal.owner.pid <= 0) {
      warnings.push(`journal ${token} has an invalid pid; leaving it in place`);
      continue;
    }
    const { warnings: rollbackWarnings } = await rollback(root, docsDir, token);
    warnings.push(...rollbackWarnings);
    rolledBack.push(token);
    await writeGraphStaleMarker(root);
  }
  return { rolledBack, warnings };
}

/**
 * Test-only helper: writes a fully authenticated journal exactly as `createJournal`/`journalReplace` would, so
 * integration tests can simulate a crashed process's leftover journal without needing the real signing key.
 * Not part of the production write path.
 */
export async function writeJournalForTest(root: string, journal: Journal, env?: NodeJS.ProcessEnv): Promise<void> {
  await writeJournalFile(root, journal.owner.token, journal, env);
}
