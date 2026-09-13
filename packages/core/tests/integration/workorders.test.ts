import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import type { Neo4jGraphStore } from '../../src/graph/store.js';
import { getWorkOrderContext } from '../../src/workorders/context.js';
import { generateWorkOrders } from '../../src/workorders/generator.js';
import { claimWorkOrder, completeWorkOrder } from '../../src/workorders/lifecycle.js';
import { commitAll, createFixtureRepo, git, openTestStore, removeDir, testConfig, writeFiles } from '@prdm/testkit';

let root: string;
let config: PrdmConfig;
let store: Neo4jGraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  store = await openTestStore(config);
  engine = new Engine(config, store);
  await engine.refresh();
});

afterAll(async () => {
  await store?.close();
  if (root) removeDir(root);
});

describe('Work Order Generator (F-04)', () => {
  test('generates a work order per pending task of a blueprint, idempotently', async () => {
    const result = await generateWorkOrders(engine, 'SDD-001');

    expect(result.skipped).toBe(0);
    expect(result.created).toEqual([
      { id: 'WO-002', path: 'docs/work-orders/WO-002-implementar-hashing-de-codigo.md', title: 'Implementar hashing de código', status: 'todo' },
      { id: 'WO-003', path: 'docs/work-orders/WO-003-leer-commits-de-git.md', title: 'Leer commits de git', status: 'done' },
    ]);
    expect(result.report.errors).toEqual([]);
    expect(result.report.issues).toEqual([]);

    const created = readFileSync(`${root}/docs/work-orders/WO-002-implementar-hashing-de-codigo.md`, 'utf8');
    expect(created).toContain('status: "todo"');

    const second = await generateWorkOrders(engine, 'SDD-001');
    expect(second.created).toEqual([]);
    expect(second.skipped).toBe(2);
  });

  test('rejects generating from a document that is not a blueprint', async () => {
    await expect(generateWorkOrders(engine, 'PRD-001')).rejects.toThrow(/not a blueprint/i);
  });

  test('rejects generating from a missing blueprint', async () => {
    await expect(generateWorkOrders(engine, 'SDD-404')).rejects.toThrow(/not found/i);
  });

  test('builds an agent-ready context bundle for a work order', async () => {
    const context = await getWorkOrderContext(store, 'WO-001');
    expect(context).not.toBeNull();

    expect(context?.workOrder).toMatchObject({ id: 'WO-001', status: 'done', assignedTo: 'agent:claude' });
    expect(context?.blueprints.map((b) => b.id)).toEqual(['SDD-001']);
    expect(context?.featureLineage.map((f) => f.id).sort()).toEqual(['MRD-001', 'PRD-001']);
    expect(context?.context.map((c) => c.id)).toEqual(['ART-001']);
    expect(context?.code.map((c) => c.path)).toEqual(['src/sync/monitor.ts']);
    expect(context?.commits.length).toBeGreaterThanOrEqual(1);
    expect(context?.drift).toEqual([]);
    expect(context?.instructions).toContain('Refs: WO-001');

    expect(await getWorkOrderContext(store, 'WO-404')).toBeNull();
  });

  test('claiming and completing a work order records blueprint_hashes and clears drift', async () => {
    const claimed = await claimWorkOrder(engine, 'WO-002', 'agent:claude');
    expect(claimed).toMatchObject({ id: 'WO-002', status: 'in_progress', assignedTo: 'agent:claude' });

    const unrelatedSha = git(root, 'rev-parse', 'HEAD').trim();
    await expect(completeWorkOrder(engine, 'WO-002', { commitSha: unrelatedSha })).rejects.toThrow(/does not reference WO-002/);
    await expect(completeWorkOrder(engine, 'WO-002', { commitSha: 'deadbeefdeadbeef' })).rejects.toThrow(/not found/);

    writeFiles(root, { 'src/sync/monitor.ts': 'export function detect() {\n  return 3;\n}\n' });
    const headSha = commitAll(root, 'feat: hash code\n\nRefs: WO-002');
    const completed = await completeWorkOrder(engine, 'WO-002', { commitSha: headSha.slice(0, 12) });
    expect(completed.status).toBe('done');
    expect(completed.resolvedBy).toContain(headSha);
    expect(completed.drift).toEqual([]);

    const content = readFileSync(`${root}/docs/work-orders/WO-002-implementar-hashing-de-codigo.md`, 'utf8');
    expect(content).toMatch(/blueprint_hashes: \{"SDD-001":"[0-9a-f]{64}"\}/);
    expect((await store.getNode('WO-002'))?.node.status).toBe('done');
  });

  test('a blueprint edit makes done work orders out_of_sync; re-completing each clears the issues', async () => {
    const sddPath = `${root}/docs/blueprints/SDD-001.md`;
    writeFiles(root, { 'docs/blueprints/SDD-001.md': readFileSync(sddPath, 'utf8').replace('compara hashes', 'compara hashes y firmas') });

    const drift = await engine.refresh();
    expect(drift.workOrderUpdates.map((u) => u.id)).toContain('WO-002');
    expect((await store.getNode('WO-002'))?.node.status).toBe('out_of_sync');

    for (const update of drift.workOrderUpdates) {
      const claimed = await claimWorkOrder(engine, update.id, 'agent:claude');
      expect(claimed.status).toBe('in_progress');
      const completed = await completeWorkOrder(engine, update.id);
      expect(completed.status).toBe('done');
    }

    const finalReport = await engine.refresh();
    expect(finalReport.issues.filter((i) => i.kind === 'work_order_out_of_sync')).toEqual([]);
  });

  test('rejects invalid state transitions and malformed inputs', async () => {
    await expect(claimWorkOrder(engine, 'WO-001', 'agent:claude')).rejects.toThrow(/status is done/);
    await expect(completeWorkOrder(engine, 'WO-003')).rejects.toThrow(/status is done/);
    await expect(claimWorkOrder(engine, 'WO-404', 'agent:claude')).rejects.toThrow(/not found/i);
    await expect(claimWorkOrder(engine, 'WO-003', 'not-an-actor')).rejects.toThrow(/invalid assignee/);
    await expect(completeWorkOrder(engine, 'WO-002', { commitSha: 'not-a-sha' })).rejects.toThrow(/invalid commit sha/);
  });
});

describe('Work Order Generator — id allocation across invalid documents (bug regression)', () => {
  test('a newly generated id skips an id already used by a document that failed validation', async () => {
    const bugRoot = createFixtureRepo();
    const bugConfig = testConfig(bugRoot);
    const bugStore = await openTestStore(bugConfig);
    const bugEngine = new Engine(bugConfig, bugStore);
    await bugEngine.refresh();

    // WO-003 here is invalid (missing `implements`), but its id must still be reserved: SDD-001 has two
    // pending/done tasks, so a naive allocator (ignoring invalid docs) would assign WO-002 then WO-003,
    // colliding with this file once both are parsed later. Reserving WO-003 pushes allocation to WO-004/WO-005.
    writeFiles(bugRoot, { 'docs/work-orders/WO-003.md': '---\nid: WO-003\ntype: WO\ntitle: "Broken work order"\n---\n' });

    try {
      const result = await generateWorkOrders(bugEngine, 'SDD-001');

      expect(result.created.map((c) => c.id)).toEqual(['WO-004', 'WO-005']);
      expect(result.report.errors.some((e) => e.path === 'docs/work-orders/WO-003.md')).toBe(true);
    } finally {
      await bugStore.close();
      removeDir(bugRoot);
    }
  });
});
