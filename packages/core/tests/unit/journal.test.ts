import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
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
} from '../../src/util/journal.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

describe('journal create/finish', () => {
  test('a finished journal leaves its file deleted and the mutation kept', async () => {
    root = makeTmpDir();
    const token = await createJournal(root);
    await journalCreate(root, token, 'docs/a.md', 'hello');
    await deleteJournal(root, token);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('hello');
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(false);
  });
});

describe('rollback', () => {
  test('undoes a created file', async () => {
    root = makeTmpDir();
    const token = await createJournal(root);
    await journalCreate(root, token, 'docs/a.md', 'hello');
    expect(existsSync(join(root, 'docs/a.md'))).toBe(true);
    await rollback(root, token);
    expect(existsSync(join(root, 'docs/a.md'))).toBe(false);
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(false);
  });

  test('restores a replaced file to its byte-identical pre-image', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'original content\n');
    const token = await createJournal(root);
    await journalReplace(root, token, 'docs/a.md', 'original content\n', 'changed content\n');
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('changed content\n');
    await rollback(root, token);
    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('original content\n');
  });

  test('undoes multiple entries in reverse order', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/b.md'), 'b-original\n');
    const token = await createJournal(root);
    await journalCreate(root, token, 'docs/a.md', 'a-content\n');
    await journalReplace(root, token, 'docs/b.md', 'b-original\n', 'b-changed\n');
    await rollback(root, token);
    expect(existsSync(join(root, 'docs/a.md'))).toBe(false);
    expect(readFileSync(join(root, 'docs/b.md'), 'utf8')).toBe('b-original\n');
  });

  test('is a no-op when the journal file is already gone', async () => {
    root = makeTmpDir();
    await expect(rollback(root, 'nonexistent-token')).resolves.toBeUndefined();
  });
});

describe('replayOrphanJournals', () => {
  test('rolls back and marks the graph stale for a journal left by a dead pid on the same host', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'original\n');
    mkdirSync(join(root, '.prdm'), { recursive: true });
    const token = 'dead-owner';
    writeFileSync(
      join(root, `.prdm/journal-${token}.json`),
      JSON.stringify({ owner: { token, pid: 2_147_483_000, host: hostname() }, entries: [{ path: 'docs/a.md', kind: 'replaced', original: Buffer.from('original\n').toString('base64') }] }),
    );
    writeFileSync(join(root, 'docs/a.md'), 'mutated\n');

    await replayOrphanJournals(root);

    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('original\n');
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(false);
    expect(await graphStaleMarkerExists(root)).toBe(true);
  });

  test('leaves a live owner journal (this process) untouched', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'mutated\n');
    mkdirSync(join(root, '.prdm'), { recursive: true });
    const token = 'live-owner';
    writeFileSync(
      join(root, `.prdm/journal-${token}.json`),
      JSON.stringify({ owner: { token, pid: process.pid, host: hostname() }, entries: [{ path: 'docs/a.md', kind: 'replaced', original: Buffer.from('original\n').toString('base64') }] }),
    );

    await replayOrphanJournals(root);

    expect(readFileSync(join(root, 'docs/a.md'), 'utf8')).toBe('mutated\n');
    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(true);
    expect(await graphStaleMarkerExists(root)).toBe(false);
  });

  test('leaves a foreign-host journal untouched (liveness cannot be checked remotely)', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    const token = 'foreign-host-owner';
    writeFileSync(join(root, `.prdm/journal-${token}.json`), JSON.stringify({ owner: { token, pid: 2_147_483_000, host: 'some-other-machine' }, entries: [] }));

    await replayOrphanJournals(root);

    expect(existsSync(join(root, `.prdm/journal-${token}.json`))).toBe(true);
  });

  test('is a no-op when there is no .prdm directory yet', async () => {
    root = makeTmpDir();
    await expect(replayOrphanJournals(root)).resolves.toBeUndefined();
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
