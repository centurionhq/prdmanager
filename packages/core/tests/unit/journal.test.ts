import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createJournal,
  deleteJournal,
  graphStaleMarkerExists,
  journalCreate,
  journalReplace,
  removeGraphStaleMarker,
  replayOrphanJournals,
  rollback,
  writeGraphStaleMarker,
  writeJournalForTest,
} from '../../src/util/journal.js';
import { sha256 } from '../../src/util/hash.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

const DOCS_DIR = 'docs';

let root = '';
let keyFile = '';

beforeEach(() => {
  // Isolate the HMAC key per test so tests never touch (or race on) the developer's real ~/.config/prdm/journal.key.
  keyFile = join(makeTmpDir('prdm-journal-key-'), 'journal.key');
  process.env.PRDM_JOURNAL_KEY_FILE = keyFile;
});

afterEach(() => {
  if (root) removeDir(root);
  delete process.env.PRDM_JOURNAL_KEY_FILE;
});

describe('journal create/finish', () => {
  test('a finished journal leaves its file deleted and the mutation kept', async () => {
    root = makeTmpDir();
    const token = await createJournal(root);
    await journalCreate(root, DOCS_DIR, token, 'docs/a.md', 'hello');
    await deleteJournal(root, token);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('hello');
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(false);
  });

  test('the journal file on disk is signed (carries a mac alongside owner/entries)', async () => {
    root = makeTmpDir();
    const token = await createJournal(root);
    const raw = JSON.parse(readFileSync(join(root, `.prdm/journal-${token}.json`), 'utf8'));
    expect(typeof raw.mac).toBe('string');
    expect(raw.mac.length).toBeGreaterThan(0);
    expect(raw.owner).toMatchObject({ token, pid: process.pid });
  });
});

describe('journalCreate: finding 2 (failed create must never delete a pre-existing file)', () => {
  test('refuses to journal-create a path that already exists, and the pre-existing file survives a later rollback', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/preexisting.md'), 'not managed by prdm\n');
    const token = await createJournal(root);

    await expect(journalCreate(root, DOCS_DIR, token, 'docs/preexisting.md', 'attacker payload')).rejects.toThrow(/already exists/);
    expect(readFileSync(join(root, 'docs/preexisting.md'), 'utf8')).toBe('not managed by prdm\n');

    // Even a hand-crafted (but authenticated) journal entry lying about this path being "created" must not
    // delete a file whose content doesn't match what the entry claims it wrote.
    await writeJournalForTest(root, {
      owner: { token, pid: process.pid, host: hostname() },
      entries: [{ path: 'docs/preexisting.md', kind: 'created', sha256: sha256('attacker payload') }],
    });
    const { warnings } = await rollback(root, DOCS_DIR, token);
    expect(readFileSync(join(root, 'docs/preexisting.md'), 'utf8')).toBe('not managed by prdm\n');
    expect(warnings.some((w) => w.includes('preexisting.md'))).toBe(true);
  });
});

describe('rollback', () => {
  test('undoes a created file', async () => {
    root = makeTmpDir();
    const token = await createJournal(root);
    await journalCreate(root, DOCS_DIR, token, 'docs/a.md', 'hello');
    expect(existsSync(join(root, 'docs/a.md'))).toBe(true);
    await rollback(root, DOCS_DIR, token);
    expect(existsSync(join(root, 'docs/a.md'))).toBe(false);
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(false);
  });

  test('restores a replaced file to its byte-identical pre-image', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'original content\n');
    const token = await createJournal(root);
    await journalReplace(root, DOCS_DIR, token, 'docs/a.md', 'original content\n', 'changed content\n');
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('changed content\n');
    await rollback(root, DOCS_DIR, token);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('original content\n');
  });

  test('undoes multiple entries in reverse order', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/b.md'), 'b-original\n');
    const token = await createJournal(root);
    await journalCreate(root, DOCS_DIR, token, 'docs/a.md', 'a-content\n');
    await journalReplace(root, DOCS_DIR, token, 'docs/b.md', 'b-original\n', 'b-changed\n');
    await rollback(root, DOCS_DIR, token);
    expect(existsSync(join(root, 'docs/a.md'))).toBe(false);
    expect(readFileSync(join(root, 'docs/b.md'), 'utf8')).toBe('b-original\n');
  });

  test('skips (with a warning) a replaced entry whose file was modified after the transaction wrote it', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'original\n');
    const token = await createJournal(root);
    await journalReplace(root, DOCS_DIR, token, 'docs/a.md', 'original\n', 'changed\n');
    // Someone else edits the file after this transaction wrote it but before rollback runs.
    writeFileSync(join(root, 'docs/a.md'), 'edited by someone else\n');

    const { warnings } = await rollback(root, DOCS_DIR, token);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('edited by someone else\n');
    expect(warnings.some((w) => w.includes('docs/a.md'))).toBe(true);
  });

  test('is a no-op when the journal file is already gone', async () => {
    root = makeTmpDir();
    await expect(rollback(root, DOCS_DIR, 'nonexistent-token')).resolves.toEqual({ warnings: [] });
  });
});

describe('journalCreate/journalReplace: path restriction (finding 1c)', () => {
  test('refuses to journal a path outside docsDir', async () => {
    root = makeTmpDir();
    const token = await createJournal(root);
    await expect(journalCreate(root, DOCS_DIR, token, '.git/config', 'evil')).rejects.toThrow(/only \.md files under docs/);
    await expect(journalCreate(root, DOCS_DIR, token, '.prdm/journal-x.json', '{}')).rejects.toThrow(/only \.md files under docs/);
    await expect(journalCreate(root, DOCS_DIR, token, 'docs/not-markdown.txt', 'evil')).rejects.toThrow(/only \.md files under docs/);
  });

  test('refuses to journal-replace a path outside docsDir', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git/config'), '[core]\n');
    const token = await createJournal(root);
    await expect(journalReplace(root, DOCS_DIR, token, '.git/config', '[core]\n', '[core]\nfsmonitor = evil\n')).rejects.toThrow(/only \.md files under docs/);
  });
});

describe('replayOrphanJournals: authentication (finding 1a/1b)', () => {
  test('a planted, unsigned journal is never rolled back and is reported as a warning', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'safe content\n');
    mkdirSync(join(root, '.prdm'), { recursive: true });
    const token = 'planted';
    // Hand-written, unsigned journal — exactly what an attacker could commit into a cloned repo.
    writeFileSync(
      join(root, `.prdm/journal-${token}.json`),
      JSON.stringify({ owner: { token, pid: 2_147_483_000, host: hostname() }, entries: [{ path: '.git/config', kind: 'replaced', sha256: sha256('evil'), original: Buffer.from('[core]\n').toString('base64') }] }),
    );

    const result = await replayOrphanJournals(root, DOCS_DIR);

    expect(result.rolledBack).toEqual([]);
    expect(result.warnings.some((w) => w.includes(token))).toBe(true);
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(true);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('safe content\n');
    expect(await graphStaleMarkerExists(root)).toBe(false);
  });

  test('a properly authenticated journal is rolled back regardless of its recorded pid (WO-023 finding 4: token-based, not liveness-based)', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'mutated\n');
    const token = 'authenticated-live-pid';
    await writeJournalForTest(root, {
      owner: { token, pid: process.pid, host: hostname() }, // "live" pid: this very process — no longer relevant to orphan detection
      entries: [{ path: 'docs/a.md', kind: 'replaced', sha256: sha256('mutated\n'), original: Buffer.from('original\n').toString('base64') }],
    });

    const result = await replayOrphanJournals(root, DOCS_DIR);

    expect(result.rolledBack).toEqual([token]);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('original\n');
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(false);
    expect(await graphStaleMarkerExists(root)).toBe(true);
  });

  test('a journal with a non-integer pid is left in place and reported', async () => {
    root = makeTmpDir();
    const token = 'bad-pid';
    await writeJournalForTest(root, { owner: { token, pid: 1.5 as unknown as number, host: hostname() }, entries: [] });
    const result = await replayOrphanJournals(root, DOCS_DIR);
    expect(result.rolledBack).toEqual([]);
    expect(result.warnings.some((w) => w.includes(token))).toBe(true);
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(true);
  });

  test('is a no-op when there is no .prdm directory yet', async () => {
    root = makeTmpDir();
    await expect(replayOrphanJournals(root, DOCS_DIR)).resolves.toEqual({ rolledBack: [], warnings: [] });
  });

  test('a journal whose only entry points outside docsDir is left in place with a warning even though it authenticates', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git/config'), '[core]\n');
    const token = 'path-escape';
    await writeJournalForTest(root, {
      owner: { token, pid: 2_147_483_000, host: hostname() },
      entries: [{ path: '.git/config', kind: 'replaced', sha256: sha256('[core]\nfsmonitor = evil\n'), original: Buffer.from('[core]\n').toString('base64') }],
    });

    const result = await replayOrphanJournals(root, DOCS_DIR);

    expect(readFileSync(join(root, '.git/config'), 'utf8')).toBe('[core]\n');
    expect(result.rolledBack).toEqual([token]); // the journal itself is deleted (it authenticated)...
    expect(result.warnings.some((w) => w.includes('.git/config'))).toBe(true); // ...but its entry was never applied
  });
});

describe('graph-stale marker', () => {
  test('write/exists/remove round-trip', async () => {
    root = makeTmpDir();
    expect(await graphStaleMarkerExists(root)).toBe(false);
    await writeGraphStaleMarker(root);
    expect(await graphStaleMarkerExists(root)).toBe(true);
    await removeGraphStaleMarker(root);
    expect(await graphStaleMarkerExists(root)).toBe(false);
  });
});

describe('journal signing key', () => {
  test('is generated on first use (32 bytes, mode 0600) and reused thereafter', async () => {
    root = makeTmpDir();
    await createJournal(root);
    expect(existsSync(keyFile)).toBe(true);
    const first = readFileSync(keyFile);
    expect(first).toHaveLength(32);
    if (process.platform !== 'win32') expect(statSync(keyFile).mode & 0o777).toBe(0o600);

    await createJournal(root); // second call must reuse the same key, not regenerate one
    expect(readFileSync(keyFile)).toEqual(first);
  });
});
