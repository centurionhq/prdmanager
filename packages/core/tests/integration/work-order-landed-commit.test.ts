import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import { createFixtureRepo, doc, openTestDb, removeDir, testConfig } from '@prdm/testkit';

let root: string;
let db: Neo4jGraphDatabase;
let store: GraphStore;

const OLD_SHA = '1'.repeat(40);
const NEW_SHA = '2'.repeat(40);
const ORPHAN_SHA = '3'.repeat(40);

const commit = (sha: string, date: string, refs: string[]) => ({ sha, author: 'dev', date, subject: `commit ${sha.slice(0, 7)}`, refs, files: [], parents: [] });

beforeAll(async () => {
  root = createFixtureRepo();
  ({ db, store } = await openTestDb(testConfig(root)));
  await store.writeSnapshot({
    docs: [
      doc('id: MRD-001\ntype: MRD\ntitle: Market', 'market'),
      doc('id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]', 'product'),
      doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/a/**"]', 'design'),
      doc('id: WO-001\ntype: WO\ntitle: Aterrizada\nstatus: pending\nimplements: [SDD-001]', 'task'),
      doc('id: WO-002\ntype: WO\ntitle: Sin commit\nstatus: pending\nimplements: [SDD-001]', 'task'),
    ],
    governed: [],
    reviewNeeded: [],
    commits: [commit(OLD_SHA, '2026-01-01', ['WO-001']), commit(NEW_SHA, '2026-06-01', ['WO-001']), commit(ORPHAN_SHA, '2026-03-01', ['WO-999'])],
  });
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('GraphStore.listWorkOrders landedCommitSha (SDD-076 D2)', () => {
  test('publishes the newest commit by date for a referenced order', async () => {
    const items = await store.listWorkOrders();
    expect(items.map((w) => w.id)).toEqual(['WO-001', 'WO-002']);
    expect(items[0]?.landedCommitSha).toBe(NEW_SHA);
  });

  test('returns null for an order no commit names, and ignores commits of unknown orders', async () => {
    const items = await store.listWorkOrders();
    expect(items[1]?.landedCommitSha).toBeNull();
  });
});
