import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { DraftStore } from '../../src/authoring/draft-store.js';
import type { DraftContent } from '../../src/authoring/types.js';
import { doc, makeTmpDir, removeDir } from '@prdm/testkit';

const LIMITS = { draftTtlMinutes: 1, maxDrafts: 2, maxDraftBytes: 200 };

const content = (title = 'Title'): DraftContent => ({ kind: 'FB', title, body: 'some body text', fields: { source: 'other' } });

let root = '';
afterEach(() => root && removeDir(root));

function draftFiles(dir: string): string[] {
  try {
    return readdirSync(join(dir, '.prdm', 'drafts')).sort();
  } catch {
    return [];
  }
}

describe('DraftStore (in-memory behavior)', () => {
  test('creates a draft with a drf_ id, revision 0 and a create target id placeholder', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const record = await store.create(content());
    expect(record.draftId).toMatch(/^drf_[A-Za-z0-9_-]{16,}$/);
    expect(record.mode).toBe('create');
    expect(record.targetId).toBe('FB-?');
    expect(record.revision).toBe(0);
  });

  test('replace bumps the revision and validates optimistic concurrency', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const record = await store.create(content('one'));
    const updated = await store.replace(record.draftId, content('two'), 0);
    expect(updated.revision).toBe(1);
    expect(updated.content.title).toBe('two');
    await expect(store.replace(record.draftId, content('three'), 0)).rejects.toThrow(/revision mismatch/);
  });

  test('enforces maxDrafts', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    await store.create(content('a'));
    await store.create(content('b'));
    await expect(store.create(content('c'))).rejects.toThrow(/draft limit reached/);
  });

  test('enforces maxDraftBytes', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    await expect(store.create({ kind: 'FB', title: 'x', body: 'y'.repeat(500) })).rejects.toThrow(/exceeds/);
  });

  test('sliding TTL: touch() extends expiry, and expired drafts disappear on sweep', async () => {
    root = makeTmpDir();
    let now = 0;
    const store = new DraftStore({ draftTtlMinutes: 1, maxDrafts: 5, maxDraftBytes: 10_000 }, root, () => new Date(now));
    const record = await store.create(content());
    now += 30_000; // 30s: well within the 60s TTL
    expect(store.touch(record.draftId)).toBeDefined();
    now += 45_000; // another 45s: within TTL again because touch() slid the window forward
    expect(store.get(record.draftId)).toBeDefined();
    now += 61_000; // no more touches: TTL elapses
    expect(store.get(record.draftId)).toBeUndefined();
  });

  test('openUpdate records the base path and the caller-supplied base hash of the target document', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const prdDoc = doc('id: PRD-001\ntype: PRD\ntitle: Product', 'body', 'docs/prd/PRD-001.md');
    const record = await store.openUpdate('PRD-001', prdDoc, { kind: 'PRD', title: 'Product v2', body: 'new body' }, 'raw-bytes-sha256');
    expect(record.mode).toBe('update');
    expect(record.targetId).toBe('PRD-001');
    expect(record.basePath).toBe('docs/prd/PRD-001.md');
    // WO-023 finding 5: baseHash is whatever the caller passed in (sha256 of raw file bytes), not the doc's parsed contentHash.
    expect(record.baseHash).toBe('raw-bytes-sha256');
  });

  test('discard-equivalent remove() drops the draft', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const record = await store.create(content());
    expect(await store.remove(record.draftId)).toBe(true);
    expect(store.get(record.draftId)).toBeUndefined();
    expect(await store.remove(record.draftId)).toBe(false);
  });

  test('tombstone remembers a commit result for retried commits, and it expires with the same TTL', async () => {
    root = makeTmpDir();
    let now = 0;
    const store = new DraftStore({ draftTtlMinutes: 1, maxDrafts: 5, maxDraftBytes: 10_000 }, root, () => new Date(now));
    const result = { draftId: 'drf_x', id: 'FB-001', path: 'docs/feedback/FB-001.md', issues: [], hasBlockingIssues: false };
    await store.tombstone('drf_x', 0, result);
    expect(store.getTombstone('drf_x', 0)).toEqual(result);
    now += 61_000;
    expect(store.getTombstone('drf_x', 0)).toBeUndefined();
  });

  test('getTombstone throws (rather than silently replaying) when the expected revision does not match the one it actually committed at (WO-023 finding 8)', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const result = { draftId: 'drf_x', id: 'FB-001', path: 'docs/feedback/FB-001.md', issues: [], hasBlockingIssues: false };
    await store.tombstone('drf_x', 2, result);
    expect(store.getTombstone('drf_x', 2)).toEqual(result);
    expect(() => store.getTombstone('drf_x', 3)).toThrow(/revision mismatch/);
  });
});

describe('DraftStore (WO-029: persistence and recovery)', () => {
  test('create/replace/openUpdate/tombstone each durably write .prdm/drafts/, and remove()/expiry clean up', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const record = await store.create(content('one'));
    expect(draftFiles(root)).toEqual([`${record.draftId}.json`]);

    const persisted = JSON.parse(readFileSync(join(root, '.prdm', 'drafts', `${record.draftId}.json`), 'utf8'));
    expect(persisted.draftId).toBe(record.draftId);
    expect(persisted.content.title).toBe('one');

    await store.replace(record.draftId, content('two'), 0);
    const afterReplace = JSON.parse(readFileSync(join(root, '.prdm', 'drafts', `${record.draftId}.json`), 'utf8'));
    expect(afterReplace.content.title).toBe('two');
    expect(afterReplace.revision).toBe(1);

    await store.tombstone(record.draftId, 1, { draftId: record.draftId, id: 'FB-001', path: 'docs/feedback/FB-001.md', issues: [], hasBlockingIssues: false });
    expect(draftFiles(root)).toEqual([`${record.draftId}.tombstone.json`]);

    await store.remove(record.draftId);
    // remove() on a draft with no active file (already tombstoned) is a harmless no-op on disk.
    expect(draftFiles(root)).toEqual([`${record.draftId}.tombstone.json`]);
  });

  test('remove() deletes the on-disk file for a discarded (non-tombstoned) draft', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const record = await store.create(content());
    expect(draftFiles(root)).toHaveLength(1);
    await store.remove(record.draftId);
    expect(draftFiles(root)).toEqual([]);
  });

  test('DraftStore.open recovers a still-valid open draft and a still-valid tombstone from a prior process', async () => {
    root = makeTmpDir();
    let now = 0;
    const first = new DraftStore({ draftTtlMinutes: 10, maxDrafts: 5, maxDraftBytes: 10_000 }, root, () => new Date(now));
    const survivor = await first.create(content('kept'));
    await first.tombstone('drf_committed', 3, { draftId: 'drf_committed', id: 'FB-002', path: 'docs/feedback/FB-002.md', issues: [], hasBlockingIssues: false });
    now = 5 * 60_000; // 5 minutes: well within the 10-minute TTL both were created under

    const { store: second, warnings } = await DraftStore.open({ draftTtlMinutes: 10, maxDrafts: 5, maxDraftBytes: 10_000 }, root, () => new Date(now));
    expect(warnings).toEqual([]);
    expect(second.get(survivor.draftId)).toMatchObject({ draftId: survivor.draftId, content: { title: 'kept' } });
    expect(second.getTombstone('drf_committed', 3)).toMatchObject({ id: 'FB-002' });
  });

  test('DraftStore.open drops an expired open draft and an expired tombstone, and removes their files', async () => {
    root = makeTmpDir();
    let now = 0;
    const first = new DraftStore({ draftTtlMinutes: 10, maxDrafts: 5, maxDraftBytes: 10_000 }, root, () => new Date(now));
    const stale = await first.create(content('stale'));
    await first.tombstone('drf_old', 1, { draftId: 'drf_old', id: 'FB-003', path: 'docs/feedback/FB-003.md', issues: [], hasBlockingIssues: false });
    now = 20 * 60_000; // 20 minutes: past the 10-minute TTL both were created under

    const { store: second, warnings } = await DraftStore.open({ draftTtlMinutes: 10, maxDrafts: 5, maxDraftBytes: 10_000 }, root, () => new Date(now));
    expect(warnings).toEqual([]);
    expect(second.get(stale.draftId)).toBeUndefined();
    expect(second.getTombstone('drf_old', 1)).toBeUndefined();
    expect(draftFiles(root)).toEqual([]); // both stale files were swept away on load
  });

  test('DraftStore.open skips a corrupt draft file with a warning instead of failing to start', async () => {
    root = makeTmpDir();
    const store = new DraftStore(LIMITS, root);
    const good = await store.create(content('good'));
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(root, '.prdm', 'drafts'), { recursive: true });
    writeFileSync(join(root, '.prdm', 'drafts', 'drf_broken.json'), '{ not json', 'utf8');

    const { store: reopened, warnings } = await DraftStore.open(LIMITS, root);
    expect(reopened.get(good.draftId)).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/drf_broken/);
  });

  test('DraftStore.open loads a fresh (non-expired) draft still within its TTL', async () => {
    root = makeTmpDir();
    const store = new DraftStore({ draftTtlMinutes: 60, maxDrafts: 5, maxDraftBytes: 10_000 }, root);
    const record = await store.create(content('fresh'));

    const { store: reopened, warnings } = await DraftStore.open({ draftTtlMinutes: 60, maxDrafts: 5, maxDraftBytes: 10_000 }, root);
    expect(warnings).toEqual([]);
    expect(reopened.get(record.draftId)).toMatchObject({ draftId: record.draftId, content: { title: 'fresh' } });
  });
});
