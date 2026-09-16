import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import { getWorkOrderContext } from '../../src/workorders/context.js';
import { addBlueprintTask, generateWorkOrders } from '../../src/workorders/generator.js';
import { claimWorkOrder, completeWorkOrder } from '../../src/workorders/lifecycle.js';
import { commitAll, createFixtureRepo, git, makeTmpDir, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';

// Isolate the journal HMAC key (WO-023 finding 1) from the developer's real ~/.config/prdm/journal.key.
process.env.PRDM_JOURNAL_KEY_FILE ??= `${makeTmpDir('prdm-journal-key-')}/journal.key`;

let root: string;
let config: PrdmConfig;
let db: Neo4jGraphDatabase;
let store: GraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
  await engine.refresh();
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('Work Order Generator (F-04)', () => {
  test('generates a work order per pending task of a blueprint, idempotently', async () => {
    const result = await generateWorkOrders(engine, 'SDD-001');

    expect(result.skipped).toBe(0);
    expect(result.created).toEqual([
      { id: 'WO-002', path: 'docs/work-orders/WO-002-implementar-hashing-de-codigo.md', title: 'Implementar hashing de código', status: 'pending' },
      { id: 'WO-003', path: 'docs/work-orders/WO-003-leer-commits-de-git.md', title: 'Leer commits de git', status: 'pending' },
    ]);
    expect(result.report.errors).toEqual([]);
    // The fixture's SDD-001 still uses the deprecated `governs` alias, and MRD-001/WO-001 predate PRD-002's
    // lifecycle rules (no `justified_by`/`source_task`); fixture.ts is shared and not owned by this WO.
    expect(result.report.issues.filter((i) => !['deprecated_field', 'lifecycle_violation'].includes(i.kind))).toEqual([]);

    const created = readFileSync(`${root}/docs/work-orders/WO-002-implementar-hashing-de-codigo.md`, 'utf8');
    expect(created).toContain('status: "pending"');

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

  test('WO-023 finding 7: refuses to generate from a blueprint that fails its own lifecycle design rule (no impacts_paths)', async () => {
    const bpRoot = createFixtureRepo();
    const bpConfig = testConfig(bpRoot);
    const { db: bpDb, store: bpStore } = await openTestDb(bpConfig);
    const bpEngine = new Engine(bpConfig, bpStore);
    await bpEngine.refresh();
    try {
      writeFiles(bpRoot, {
        'docs/blueprints/SDD-002.md': '---\nid: SDD-002\ntype: SDD\ntitle: "Bad design"\narchitects: ["PRD-001"]\n---\ndesign\n\n## Tareas\n- [ ] Uno\n',
      });
      await bpEngine.refresh();
      await expect(generateWorkOrders(bpEngine, 'SDD-002')).rejects.toThrow(/fails its lifecycle design rule/);
    } finally {
      await bpDb.close();
      removeDir(bpRoot);
    }
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
    expect(completed.drift.filter((i) => i.kind !== 'deprecated_field')).toEqual([]);

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
    await expect(completeWorkOrder(engine, 'WO-003')).rejects.toThrow(/status is pending/);
    await expect(claimWorkOrder(engine, 'WO-404', 'agent:claude')).rejects.toThrow(/not found/i);
    await expect(claimWorkOrder(engine, 'WO-003', 'not-an-actor')).rejects.toThrow(/invalid assignee/);
    await expect(completeWorkOrder(engine, 'WO-002', { commitSha: 'not-a-sha' })).rejects.toThrow(/invalid commit sha/);
  });
});

describe('addBlueprintTask (remote MCP `add_blueprint_task`, SDD-010 revisited)', () => {
  test('appends a new checklist item to an existing ## Tareas section, which generateWorkOrders then picks up', async () => {
    const taskRoot = createFixtureRepo();
    const taskConfig = testConfig(taskRoot);
    const { db: taskDb, store: taskStore } = await openTestDb(taskConfig);
    const taskEngine = new Engine(taskConfig, taskStore);
    await taskEngine.refresh();
    try {
      const result = await addBlueprintTask(taskEngine, 'SDD-001', 'Agregar métricas de latencia');
      expect(result).toEqual({ blueprint_id: 'SDD-001', task: 'Agregar métricas de latencia' });

      const updated = readFileSync(`${taskRoot}/docs/blueprints/SDD-001.md`, 'utf8');
      expect(updated).toContain('- [ ] Agregar métricas de latencia');
      // The two pre-existing tasks stay intact and the new one lands after them, still inside ## Tareas.
      expect(updated.indexOf('Leer commits de git')).toBeLessThan(updated.indexOf('Agregar métricas de latencia'));

      await taskEngine.refresh();
      const generated = await generateWorkOrders(taskEngine, 'SDD-001');
      expect(generated.created.map((c) => c.title)).toContain('Agregar métricas de latencia');
    } finally {
      await taskDb.close();
      removeDir(taskRoot);
    }
  });

  test('creates a ## Tareas section when the blueprint has none yet', async () => {
    const taskRoot = createFixtureRepo();
    const taskConfig = testConfig(taskRoot);
    const { db: taskDb, store: taskStore } = await openTestDb(taskConfig);
    const taskEngine = new Engine(taskConfig, taskStore);
    await taskEngine.refresh();
    try {
      writeFiles(taskRoot, {
        'docs/blueprints/SDD-002.md': '---\nid: SDD-002\ntype: SDD\ntitle: "Sin tareas todavía"\narchitects: ["PRD-001"]\nimpacts_paths: ["src/**"]\n---\ndiseño sin checklist\n',
      });
      await taskEngine.refresh();

      await addBlueprintTask(taskEngine, 'SDD-002', 'Primera tarea');
      const updated = readFileSync(`${taskRoot}/docs/blueprints/SDD-002.md`, 'utf8');
      expect(updated).toMatch(/## Tareas\s*\n\s*- \[ \] Primera tarea/);
    } finally {
      await taskDb.close();
      removeDir(taskRoot);
    }
  });

  test('rejects an empty task, one over the length cap, a non-blueprint id and a missing blueprint', async () => {
    const taskRoot = createFixtureRepo();
    const taskConfig = testConfig(taskRoot);
    const { db: taskDb, store: taskStore } = await openTestDb(taskConfig);
    const taskEngine = new Engine(taskConfig, taskStore);
    await taskEngine.refresh();
    try {
      await expect(addBlueprintTask(taskEngine, 'SDD-001', '   ')).rejects.toThrow(/must not be empty/);
      await expect(addBlueprintTask(taskEngine, 'SDD-001', 'x'.repeat(501))).rejects.toThrow(/at most 500 characters/);
      await expect(addBlueprintTask(taskEngine, 'PRD-001', 'x')).rejects.toThrow(/not a blueprint/i);
      await expect(addBlueprintTask(taskEngine, 'SDD-404', 'x')).rejects.toThrow(/not found/i);
    } finally {
      await taskDb.close();
      removeDir(taskRoot);
    }
  });
});

describe('Work Order Generator — id allocation across invalid documents (bug regression)', () => {
  test('a newly generated id skips an id already used by a document that failed validation', async () => {
    const bugRoot = createFixtureRepo();
    const bugConfig = testConfig(bugRoot);
    const { db: bugDb, store: bugStore } = await openTestDb(bugConfig);
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
      await bugDb.close();
      removeDir(bugRoot);
    }
  });
});
