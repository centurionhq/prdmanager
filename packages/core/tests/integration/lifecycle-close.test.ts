import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeFeature, closureReadiness, Engine, type GraphStore, type Neo4jGraphDatabase, type PrdmConfig, type ProjectEngine, type RefreshReport } from '@prdm/core';
import { commitAll, gitInit, makeTmpDir, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';

// Isolate the journal HMAC key (WO-023 finding 1) from the developer's real ~/.config/prdm/journal.key: closeFeature now runs atomically.
process.env.PRDM_JOURNAL_KEY_FILE ??= `${makeTmpDir('prdm-journal-key-')}/journal.key`;

let root: string;
let config: PrdmConfig;
let db: Neo4jGraphDatabase;
let store: GraphStore;
let engine: Engine;

const FILES: Record<string, string> = {
  'prdm.config.json': JSON.stringify({ ignore: [] }),
  'docs/mrd/MRD-001.md': '---\nid: MRD-001\ntype: MRD\ntitle: "Market"\nstatus: approved\n---\ncontext\n',
  'docs/prd/PRD-001.md': '---\nid: PRD-001\ntype: PRD\ntitle: "Product"\nstatus: approved\nimplements: ["MRD-001"]\n---\nproduct\n',
  'docs/feedback/FB-001.md': '---\nid: FB-001\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["MRD-001", "PRD-001"]\n---\nfeedback\n',
  'docs/blueprints/SDD-001.md': '---\nid: SDD-001\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-001"]\nimpacts_paths: ["src/foo.ts"]\n---\ndesign\n\n## Tareas\n- [x] hecho\n',
  'docs/work-orders/WO-001.md': '---\nid: WO-001\ntype: WO\ntitle: "Task"\nstatus: in_progress\nimplements: ["SDD-001"]\nsource_task: "t1"\n---\nobjetivo\n',
  'src/foo.ts': 'export const foo = 1;\n',
};

beforeAll(async () => {
  root = makeTmpDir('prdm-close-');
  writeFiles(root, FILES);
  gitInit(root);
  commitAll(root, 'chore: initial docs');
  config = testConfig(root);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
  await engine.refresh();
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('closureReadiness / closeFeature (WO-019, PRD-002 §3 "Cierre")', () => {
  test('reports not-ready with per-check detail when the feature does not exist', async () => {
    const readiness = await closureReadiness(engine, 'PRD-404');
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((c) => c.name === 'feature_exists')).toMatchObject({ ok: false });
  });

  test('reports not-ready while its work order is not done', async () => {
    const readiness = await closureReadiness(engine, 'PRD-001');
    expect(readiness.ready).toBe(false);
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'feature_exists', ok: true }),
        expect.objectContaining({ name: 'feature_approved', ok: true }),
        expect.objectContaining({ name: 'blueprints_have_work_orders', ok: true }),
        expect.objectContaining({ name: 'work_orders_done', ok: false }),
      ]),
    );
  });

  test('closeFeature refuses to close while the readiness gate fails', async () => {
    await expect(closeFeature(engine, 'PRD-001', { by: 'dev:tester' })).rejects.toThrow(/not ready to close/);
  });

  test('closeFeature closes once every check passes, and acknowledges the feature', async () => {
    writeFiles(root, { 'docs/work-orders/WO-001.md': FILES['docs/work-orders/WO-001.md']!.replace('status: in_progress', 'status: done') });
    await engine.refresh();

    const readiness = await closureReadiness(engine, 'PRD-001');
    expect(readiness.ready).toBe(true);

    const result = await closeFeature(engine, 'PRD-001', { by: 'dev:tester', now: new Date('2026-09-13T00:00:00.000Z') });
    expect(result).toMatchObject({ featureId: 'PRD-001', closedAt: '2026-09-13T00:00:00.000Z', closedBy: 'dev:tester' });
    expect(result.report.hasBlockingIssues).toBe(false);

    const node = await store.getNode('PRD-001');
    expect(node?.node).toMatchObject({ status: 'closed', closed_by: 'dev:tester' });
  });

  test('closeFeature validates the "by" actor', async () => {
    await expect(closeFeature(engine, 'PRD-001', { by: 'not-an-actor' })).rejects.toThrow(/invalid "by" actor/);
  });
});

describe('WO-023 finding 9: closureReadiness is read-only; closeFeature re-checks under the lock', () => {
  test('closureReadiness never writes the baseline or a graph snapshot', async () => {
    const baselineBefore = readFileSync(join(root, '.prdm/baseline.json'));
    const nodeBefore = await store.getNode('PRD-001');

    await closureReadiness(engine, 'PRD-001');

    expect(readFileSync(join(root, '.prdm/baseline.json'))).toEqual(baselineBefore);
    expect(await store.getNode('PRD-001')).toEqual(nodeBefore);
  });

  test('closeFeature refuses to close when a concurrent change makes the feature no longer ready between the initial check and the in-lock recheck', async () => {
    const raceRoot = makeTmpDir('prdm-close-race-');
    const files: Record<string, string> = {
      'prdm.config.json': JSON.stringify({ ignore: [] }),
      'docs/prd/PRD-777.md': '---\nid: PRD-777\ntype: PRD\ntitle: "Racy"\nstatus: approved\njustified_by: ["FB-777"]\n---\nproduct\n',
      'docs/feedback/FB-777.md': '---\nid: FB-777\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["PRD-777"]\n---\nfeedback\n',
      'docs/blueprints/SDD-777.md': '---\nid: SDD-777\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-777"]\nimpacts_paths: ["src/bar.ts"]\n---\ndesign\n\n## Tareas\n- [x] hecho\n',
      'docs/work-orders/WO-777.md': '---\nid: WO-777\ntype: WO\ntitle: "Task"\nstatus: done\nimplements: ["SDD-777"]\nsource_task: "t777"\n---\nobjetivo\n',
      'src/bar.ts': 'export const bar = 1;\n',
    };
    writeFiles(raceRoot, files);
    gitInit(raceRoot);
    commitAll(raceRoot, 'chore: initial docs');
    const raceConfig = testConfig(raceRoot);
    const { db: raceDb, store: raceStore } = await openTestDb(raceConfig);
    const raceEngine = new Engine(raceConfig, raceStore);
    await raceEngine.refresh();

    // Duck-types just enough of Engine's public surface for closureReadiness/closeFeature; its `inspect()`
    // simulates a concurrent actor: the FIRST call (the outer, pre-lock readiness check) returns the genuinely
    // clean report, then — as if another process had just landed a change — reverts WO-777 to "in_progress" on
    // disk. `transaction()` delegates to the real engine, so the SECOND check (inside the transaction, under
    // the lock, via the real `ops.inspect()`) sees that mutation and must catch what the first check could not.
    let calls = 0;
    const flakyEngine = {
      config: raceEngine.config,
      store: raceEngine.store,
      inspect: async (): Promise<RefreshReport> => {
        calls += 1;
        const report = await raceEngine.inspect();
        if (calls === 1) writeFileSync(join(raceRoot, 'docs/work-orders/WO-777.md'), files['docs/work-orders/WO-777.md']!.replace('status: done', 'status: in_progress'));
        return report;
      },
      transaction: raceEngine.transaction.bind(raceEngine),
      acknowledge: raceEngine.acknowledge.bind(raceEngine),
      recover: raceEngine.recover.bind(raceEngine),
      scan: raceEngine.scan.bind(raceEngine),
    } as unknown as ProjectEngine;

    try {
      // closeFeature's OWN internal outer check (calls === 1) captures the docs snapshot before `inspect()` runs,
      // so it still reports ready=true; the mutation lands as a side effect of that very call, to be picked up
      // only by the second, in-lock recheck.
      await expect(closeFeature(flakyEngine, 'PRD-777', { by: 'dev:tester' })).rejects.toThrow(/no longer ready to close/);
      // The outer check (through flakyEngine.inspect) ran exactly once; the second, catching check ran through
      // the REAL engine's own ops.inspect() inside the transaction (untouched by this wrapper) — proof that the
      // in-lock recheck, not the outer one, is what caught the concurrent change.
      expect(calls).toBe(1);
      // and, crucially, nothing was written: the feature was never marked closed.
      expect((await raceStore.getNode('PRD-777'))?.node.status).not.toBe('closed');
    } finally {
      await raceDb.close();
      removeDir(raceRoot);
    }
  });
});
