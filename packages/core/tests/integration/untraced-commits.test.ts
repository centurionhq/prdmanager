import { describe, expect, test } from 'vitest';
import type { CommitInfo } from '../../src/sync/git.js';
import { getMetrics } from '../../src/metrics/metrics.js';
import { createFixtureRepo, doc, openTestDb, removeDir, testConfig } from '@prdm/testkit';

/** SDD-080 WO-A: los invariantes de `untracedCommits` contra Neo4j real. */
const DOCS = [
  doc('id: MRD-001\ntype: MRD\ntitle: Market', 'market'),
  doc('id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]', 'product'),
  doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/a/**"]', 'design'),
  doc('id: WO-001\ntype: WO\ntitle: Traced\nstatus: done\nimplements: [SDD-001]', 'task'),
  // SDD-002 architecta una Feature inexistente: WO-002 resuelve y llega a un Blueprint, pero la cadena no cierra en una Feature.
  doc('id: SDD-002\ntype: SDD\ntitle: Loose design\narchitects: [PRD-404]\nimpacts_paths: ["src/b/**"]', 'design'),
  doc('id: WO-002\ntype: WO\ntitle: Loose\nstatus: pending\nimplements: [SDD-002]', 'task'),
];

function commit(sha: string, refs: string[], date = '2026-01-01T00:00:00Z'): CommitInfo {
  return { sha, author: 'dev', date, subject: `subject ${sha}`, refs, files: ['src/a/x.ts'], parents: [] };
}

async function withCommits<T>(commits: CommitInfo[], fn: (store: Awaited<ReturnType<typeof openTestDb>>['store']) => Promise<T>): Promise<T> {
  const root = createFixtureRepo();
  const { db, store } = await openTestDb(testConfig(root));
  try {
    await store.writeSnapshot({ docs: DOCS, governed: [], reviewNeeded: [], commits });
    return await fn(store);
  } finally {
    await db.close();
    removeDir(root);
  }
}

describe('store.untracedCommits', () => {
  test('empty project: no commits at all', async () => {
    await withCommits([], async (store) => {
      expect(await store.untracedCommits()).toEqual({ total: 0, danglingRefs: 0, truncated: false, items: [] });
    });
  });

  test('every commit traced: the subquery returns no rows and maps to the empty case', async () => {
    await withCommits([commit('t1', ['WO-001']), commit('t2', ['WO-001'])], async (store) => {
      expect(await store.untracedCommits()).toEqual({ total: 0, danglingRefs: 0, truncated: false, items: [] });
    });
  });

  test('mixed: no refs, unknown WO and WO whose blueprint architects no Feature; identities hold against metricsRaw', async () => {
    const commits = [
      commit('a1', ['WO-001'], '2026-01-01T00:00:01Z'),
      commit('a2', ['WO-001'], '2026-01-01T00:00:02Z'),
      commit('b1', [], '2026-01-02T00:00:00Z'),
      commit('b2', [], '2026-01-02T00:00:00Z'),
      commit('c1', ['WO-999'], '2026-01-01T00:00:00Z'),
      commit('c2', ['WO-002'], '2026-01-01T00:00:00Z'),
    ];
    await withCommits(commits, async (store) => {
      const untraced = await store.untracedCommits();
      const raw = await store.metricsRaw();

      expect(untraced.total).toBe(4);
      expect(untraced.danglingRefs).toBe(2);
      expect(untraced.items.map((i) => i.gap)).toEqual(['no_refs', 'no_refs', 'dangling_refs', 'dangling_refs']);
      expect(untraced.total).toBe(raw.commitsTotal - raw.commitsTraced);
      expect(untraced.danglingRefs).toBe(raw.commitsWithRefs - raw.commitsTraced);
    });
  });

  test('every commit without refs', async () => {
    await withCommits([commit('a', []), commit('b', []), commit('c', [])], async (store) => {
      const untraced = await store.untracedCommits();
      const raw = await store.metricsRaw();
      expect(untraced.total).toBe(3);
      expect(untraced.total).toBe(raw.commitsTotal);
      expect(untraced.danglingRefs).toBe(0);
      expect(untraced.items.every((i) => i.gap === 'no_refs')).toBe(true);
    });
  });

  test('caps items at 200 but keeps the exact total', async () => {
    const commits = Array.from({ length: 205 }, (_, i) => commit(`s${String(i).padStart(3, '0')}`, []));
    await withCommits(commits, async (store) => {
      const untraced = await store.untracedCommits();
      expect(untraced.total).toBe(205);
      expect(untraced.danglingRefs).toBe(0);
      expect(untraced.items).toHaveLength(200);
      expect(untraced.truncated).toBe(true);
    });
  });

  test('orders by date descending and breaks ties by sha ascending', async () => {
    const commits = [
      commit('bbb', [], '2026-01-01T00:00:00Z'),
      commit('ccc', [], '2026-03-01T00:00:00Z'),
      commit('aaa', [], '2026-01-01T00:00:00Z'),
      commit('ddd', [], '2026-02-01T00:00:00Z'),
    ];
    await withCommits(commits, async (store) => {
      expect((await store.untracedCommits()).items.map((i) => i.sha)).toEqual(['ccc', 'ddd', 'aaa', 'bbb']);
    });
  });

  test('getMetrics carries the same list in the same payload', async () => {
    await withCommits([commit('a', []), commit('b', ['WO-999']), commit('t', ['WO-001'])], async (store) => {
      const metrics = await getMetrics(store);
      expect(metrics.traceability.untracedCommits).toEqual(await store.untracedCommits());
      expect(metrics.traceability.untracedCommits.total).toBe(2);
    });
  });
});
