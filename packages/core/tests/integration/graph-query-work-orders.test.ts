import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import { createFixtureRepo, doc, openTestDb, removeDir, testConfig } from '@prdm/testkit';

let root: string;
let db: Neo4jGraphDatabase;
let store: GraphStore;

const wo = (n: string, status: string, assignedTo: string | undefined, blueprint: string, title: string) =>
  doc(`id: ${n}\ntype: WO\ntitle: ${title}\nstatus: ${status}\nimplements: [${blueprint}]${assignedTo ? `\nassigned_to: ${assignedTo}` : ''}`, 'task');

const ids = async (filter: Parameters<GraphStore['queryWorkOrders']>[0]) => (await store.queryWorkOrders(filter)).items.map((w) => w.id);

beforeAll(async () => {
  root = createFixtureRepo();
  ({ db, store } = await openTestDb(testConfig(root)));
  await store.writeSnapshot({
    docs: [
      doc('id: MRD-001\ntype: MRD\ntitle: Market', 'market'),
      doc('id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]', 'product'),
      doc('id: SDD-001\ntype: SDD\ntitle: Design one\narchitects: [PRD-001]\nimpacts_paths: ["src/a/**"]', 'design'),
      doc('id: SDD-002\ntype: SDD\ntitle: Design two\narchitects: [PRD-001]\nimpacts_paths: ["src/b/**"]', 'design'),
    wo('WO-001', 'pending', 'agent:claude', 'SDD-001', 'Task alpha'),
    wo('WO-002', 'pending', 'dev:martin', 'SDD-001', 'Password hashing'),
    wo('WO-003', 'in_progress', 'dev:martin', 'SDD-002', 'Task gamma'),
    wo('WO-004', 'done', 'agent:claude', 'SDD-001', 'Task delta'),
    wo('WO-005', 'out_of_sync', undefined, 'SDD-002', 'Task epsilon'),
    wo('WO-006', 'archived', 'agent:claude', 'SDD-001', 'Task zeta'),
    wo('WO-007', 'pending', undefined, 'SDD-002', 'Task eta'),
    wo('WO-008', 'done', 'dev:ana', 'SDD-002', 'Task theta'),
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

const BASE_COUNTS = { all: 7, pending: 3, in_progress: 1, out_of_sync: 1, done: 2, archived: 1 };

describe('GraphStore.queryWorkOrders (SDD-064)', () => {
  test('default excludes archived, orders by id and counts the base', async () => {
    const page = await store.queryWorkOrders();
    expect(page.items.map((w) => w.id)).toEqual(['WO-001', 'WO-002', 'WO-003', 'WO-004', 'WO-005', 'WO-007', 'WO-008']);
    expect(page.total).toBe(7);
    expect(page.statusCounts).toEqual(BASE_COUNTS);
    expect(page.items[0]).toMatchObject({ title: 'Task alpha', status: 'pending', assignedTo: 'agent:claude', blueprints: ['SDD-001'] });
  });

  test('status filters, with archived only reachable explicitly', async () => {
    const archived = await store.queryWorkOrders({ status: 'archived' });
    expect(archived.items.map((w) => w.id)).toEqual(['WO-006']);
    expect(archived.total).toBe(1);
    expect(await ids({ status: 'done' })).toEqual(['WO-004', 'WO-008']);
  });

  test('blueprint filter narrows items, total and counts', async () => {
    const page = await store.queryWorkOrders({ blueprint: 'SDD-001' });
    expect(page.items.map((w) => w.id)).toEqual(['WO-001', 'WO-002', 'WO-004']);
    expect(page.total).toBe(3);
    expect(page.statusCounts.all).toBe(3);
    expect(page.statusCounts.archived).toBe(1);
  });

  test('actorKind filters by assignee class', async () => {
    expect(await ids({ actorKind: 'agent' })).toEqual(['WO-001', 'WO-004']);
    expect(await ids({ actorKind: 'unassigned' })).toEqual(['WO-005', 'WO-007']);
    expect(await ids({ actorKind: 'dev' })).toEqual(['WO-002', 'WO-003', 'WO-008']);
  });

  test('assignedTo matches the exact account', async () => {
    expect(await ids({ assignedTo: 'dev:martin' })).toEqual(['WO-002', 'WO-003']);
  });

  test('q is case-insensitive over title, id, blueprint id and assignee', async () => {
    expect(await ids({ q: 'HASHING' })).toEqual(['WO-002']);
    expect(await ids({ q: 'wo-00' })).toHaveLength(7);
    expect(await ids({ q: 'sdd-002' })).toEqual(['WO-003', 'WO-005', 'WO-007', 'WO-008']);
    expect(await ids({ q: 'MARTIN' })).toEqual(['WO-002', 'WO-003']);
  });

  test('limit/offset paginate while total stays the full subset', async () => {
    const p1 = await store.queryWorkOrders({ limit: 2, offset: 0 });
    expect(p1.items.map((w) => w.id)).toEqual(['WO-001', 'WO-002']);
    expect(p1.total).toBe(7);
    expect(await ids({ limit: 2, offset: 2 })).toEqual(['WO-003', 'WO-004']);
    expect(await ids({ limit: 2, offset: 6 })).toEqual(['WO-008']);
    expect((await store.queryWorkOrders({ limit: 200 })).items).toHaveLength(7);
    const arch = await store.queryWorkOrders({ status: 'archived', limit: 1 });
    expect(arch.total).toBe(1);
    expect(arch.items).toHaveLength(1);
  });

  test('statusCounts ignore the status filter', async () => {
    const page = await store.queryWorkOrders({ status: 'done' });
    expect(page.total).toBe(2);
    expect(page.statusCounts).toEqual(BASE_COUNTS);
    const sdd2 = await store.queryWorkOrders({ blueprint: 'SDD-002' });
    expect(sdd2.statusCounts).toEqual({ all: 4, pending: 1, in_progress: 1, out_of_sync: 1, done: 1, archived: 0 });
  });

  test('listWorkOrders is untouched (D1)', async () => {
    const all = await store.listWorkOrders();
    expect(Array.isArray(all)).toBe(true);
    expect(all.map((w) => w.id)).toContain('WO-001');
  });

  test('an empty result still returns one well-formed row', async () => {
    const page = await store.queryWorkOrders({ q: 'no-such-thing-xyz' });
    expect(page).toEqual({ items: [], total: 0, statusCounts: { all: 0, pending: 0, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 } });
  });
});
