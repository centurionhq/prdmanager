import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import { createFixtureRepo, doc, openTestDb, removeDir, testConfig } from '@prdm/testkit';

let root: string;
let db: Neo4jGraphDatabase;
let store: GraphStore;

beforeAll(async () => {
  root = createFixtureRepo();
  ({ db, store } = await openTestDb(testConfig(root)));
  await store.writeSnapshot({
    docs: [
      doc('id: MRD-001\ntype: MRD\ntitle: Market', 'market'),
      doc('id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]', 'product'),
      doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\nimpacts_paths: ["src/a/**"]', 'design'),
      doc('id: WO-001\ntype: WO\ntitle: Con fechas\nstatus: in_progress\nimplements: [SDD-001]\ncreated_at: "2020-01-01"\nclaimed_at: "2026-10-06T03:37:41.794Z"', 'task'),
      doc('id: WO-002\ntype: WO\ntitle: Sin fechas\nstatus: pending\nimplements: [SDD-001]', 'task'),
    ],
    governed: [],
    reviewNeeded: [],
    commits: [],
  });
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('GraphStore.listWorkOrders dates (SDD-075 D1)', () => {
  test('publishes created_at/claimed_at and derives ageDays, ordered by id', async () => {
    const items = await store.listWorkOrders();
    expect(items.map((w) => w.id)).toEqual(['WO-001', 'WO-002']);
    expect(items[0]).toMatchObject({ createdAt: '2020-01-01', claimedAt: '2026-10-06T03:37:41.794Z' });
    expect(items[0]?.ageDays).toBeGreaterThan(2000);
  });

  test('returns null in the three fields when the node has no dates', async () => {
    const items = await store.listWorkOrders();
    expect(items[1]).toMatchObject({ createdAt: null, claimedAt: null, ageDays: null });
  });
});
