import { describe, expect, test } from 'vitest';
import { DraftStore } from '../../src/authoring/draft-store.js';
import type { DraftContent } from '../../src/authoring/types.js';
import { doc } from '@prdm/testkit';

const LIMITS = { draftTtlMinutes: 1, maxDrafts: 2, maxDraftBytes: 200 };

const content = (title = 'Title'): DraftContent => ({ kind: 'FB', title, body: 'some body text', fields: { source: 'other' } });

describe('DraftStore', () => {
  test('creates a draft with a drf_ id, revision 0 and a create target id placeholder', () => {
    const store = new DraftStore(LIMITS);
    const record = store.create(content());
    expect(record.draftId).toMatch(/^drf_[A-Za-z0-9_-]{16,}$/);
    expect(record.mode).toBe('create');
    expect(record.targetId).toBe('FB-?');
    expect(record.revision).toBe(0);
  });

  test('replace bumps the revision and validates optimistic concurrency', () => {
    const store = new DraftStore(LIMITS);
    const record = store.create(content('one'));
    const updated = store.replace(record.draftId, content('two'), 0);
    expect(updated.revision).toBe(1);
    expect(updated.content.title).toBe('two');
    expect(() => store.replace(record.draftId, content('three'), 0)).toThrow(/revision mismatch/);
  });

  test('enforces maxDrafts', () => {
    const store = new DraftStore(LIMITS);
    store.create(content('a'));
    store.create(content('b'));
    expect(() => store.create(content('c'))).toThrow(/draft limit reached/);
  });

  test('enforces maxDraftBytes', () => {
    const store = new DraftStore(LIMITS);
    expect(() => store.create({ kind: 'FB', title: 'x', body: 'y'.repeat(500) })).toThrow(/exceeds/);
  });

  test('sliding TTL: touch() extends expiry, and expired drafts disappear on sweep', async () => {
    let now = 0;
    const store = new DraftStore({ draftTtlMinutes: 1, maxDrafts: 5, maxDraftBytes: 10_000 }, () => new Date(now));
    const record = store.create(content());
    now += 30_000; // 30s: well within the 60s TTL
    expect(store.touch(record.draftId)).toBeDefined();
    now += 45_000; // another 45s: within TTL again because touch() slid the window forward
    expect(store.get(record.draftId)).toBeDefined();
    now += 61_000; // no more touches: TTL elapses
    expect(store.get(record.draftId)).toBeUndefined();
  });

  test('openUpdate records the base path and content hash of the target document', () => {
    const store = new DraftStore(LIMITS);
    const prdDoc = doc('id: PRD-001\ntype: PRD\ntitle: Product', 'body', 'docs/prd/PRD-001.md');
    const record = store.openUpdate('PRD-001', prdDoc, { kind: 'PRD', title: 'Product v2', body: 'new body' });
    expect(record.mode).toBe('update');
    expect(record.targetId).toBe('PRD-001');
    expect(record.basePath).toBe('docs/prd/PRD-001.md');
    expect(record.baseHash).toBe(prdDoc.node.contentHash);
  });

  test('discard-equivalent remove() drops the draft', () => {
    const store = new DraftStore(LIMITS);
    const record = store.create(content());
    expect(store.remove(record.draftId)).toBe(true);
    expect(store.get(record.draftId)).toBeUndefined();
    expect(store.remove(record.draftId)).toBe(false);
  });

  test('tombstone remembers a commit result for retried commits, and it expires with the same TTL', () => {
    let now = 0;
    const store = new DraftStore({ draftTtlMinutes: 1, maxDrafts: 5, maxDraftBytes: 10_000 }, () => new Date(now));
    const result = { draftId: 'drf_x', id: 'FB-001', path: 'docs/feedback/FB-001.md', issues: [], hasBlockingIssues: false };
    store.tombstone('drf_x', result);
    expect(store.getTombstone('drf_x')).toEqual(result);
    now += 61_000;
    expect(store.getTombstone('drf_x')).toBeUndefined();
  });
});
