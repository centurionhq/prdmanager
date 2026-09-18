import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  closeFeature,
  closureReadiness,
  Engine,
  forceCloseFeature,
  type ForceCloseBypassableCheck,
  type GraphStore,
  type Neo4jGraphDatabase,
  type PrdmConfig,
  type ProjectEngine,
  type RefreshReport,
} from '@prdm/core';
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
  'docs/business-case/BC-001.md':
    '---\nid: BC-001\ntype: BC\ntitle: "Business case"\nstatus: approved\njustified_by: ["FB-001"]\n---\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
  'docs/prd/PRD-001.md': '---\nid: PRD-001\ntype: PRD\ntitle: "Product"\nstatus: approved\nimplements: ["MRD-001"]\njustified_by: ["BC-001"]\n---\nproduct\n',
  'docs/feedback/FB-001.md': '---\nid: FB-001\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["MRD-001", "PRD-001", "BC-001"]\n---\nfeedback\n',
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

describe('work_orders_done excludes archived work orders (WO-414, SDD-018)', () => {
  test('a normal (non-forced) closeFeature succeeds when a blueprint has a mix of done and archived work orders', async () => {
    const mixRoot = makeTmpDir('prdm-close-archived-');
    const mixFiles: Record<string, string> = {
      'prdm.config.json': JSON.stringify({ ignore: [] }),
      'docs/business-case/BC-500.md': '---\nid: BC-500\ntype: BC\ntitle: "BC 500"\nstatus: approved\njustified_by: ["FB-500"]\n---\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
      'docs/prd/PRD-500.md': '---\nid: PRD-500\ntype: PRD\ntitle: "Mixed"\nstatus: approved\njustified_by: ["BC-500"]\n---\nproduct\n',
      'docs/feedback/FB-500.md': '---\nid: FB-500\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["PRD-500"]\n---\nfeedback\n',
      'docs/blueprints/SDD-500.md': '---\nid: SDD-500\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-500"]\nimpacts_paths: ["src/mixed.ts"]\n---\ndesign\n\n## Tareas\n- [x] hecho\n- [x] archivado\n',
      'docs/work-orders/WO-500.md': '---\nid: WO-500\ntype: WO\ntitle: "Done task"\nstatus: done\nimplements: ["SDD-500"]\nsource_task: "t500"\n---\nobjetivo\n',
      'docs/work-orders/WO-501.md': '---\nid: WO-501\ntype: WO\ntitle: "Archived task"\nstatus: archived\nimplements: ["SDD-500"]\nsource_task: "t501"\narchived_at: "2026-09-01T00:00:00.000Z"\narchived_by: "dev:tester"\narchive_reason: "no longer needed"\n---\nobjetivo\n',
      'src/mixed.ts': 'export const mixed = 1;\n',
    };
    writeFiles(mixRoot, mixFiles);
    gitInit(mixRoot);
    commitAll(mixRoot, 'chore: initial docs');
    const mixConfig = testConfig(mixRoot);
    const { db: mixDb, store: mixStore } = await openTestDb(mixConfig);
    const mixEngine = new Engine(mixConfig, mixStore);
    await mixEngine.refresh();
    try {
      const readiness = await closureReadiness(mixEngine, 'PRD-500');
      expect(readiness.checks.find((c) => c.name === 'work_orders_done')).toMatchObject({ ok: true });
      expect(readiness.ready).toBe(true);

      const result = await closeFeature(mixEngine, 'PRD-500', { by: 'dev:tester' });
      expect(result.featureId).toBe('PRD-500');
      expect((await mixStore.getNode('PRD-500'))?.node.status).toBe('closed');
    } finally {
      await mixDb.close();
      removeDir(mixRoot);
    }
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
      'docs/business-case/BC-777.md': '---\nid: BC-777\ntype: BC\ntitle: "BC 777"\nstatus: approved\njustified_by: ["FB-777"]\n---\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
      'docs/prd/PRD-777.md': '---\nid: PRD-777\ntype: PRD\ntitle: "Racy"\nstatus: approved\njustified_by: ["BC-777"]\n---\nproduct\n',
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

describe('forceCloseFeature (WO-417, SDD-018)', () => {
  let fcRoot: string;
  let fcConfig: PrdmConfig;
  let fcDb: Neo4jGraphDatabase;
  let fcStore: GraphStore;
  let fcEngine: Engine;

  const FC_FILES: Record<string, string> = {
    'prdm.config.json': JSON.stringify({ ignore: [] }),

    // PRD-601: approved + justified, blueprint has no work order at all -> only blueprints_have_work_orders fails.
    'docs/business-case/BC-601.md': '---\nid: BC-601\ntype: BC\ntitle: "BC 601"\nstatus: approved\njustified_by: ["FB-601"]\n---\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
'docs/prd/PRD-601.md': '---\nid: PRD-601\ntype: PRD\ntitle: "No WOs"\nstatus: approved\njustified_by: ["BC-601"]\n---\nproduct\n',
    'docs/feedback/FB-601.md': '---\nid: FB-601\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["PRD-601"]\n---\nfeedback\n',
    'docs/blueprints/SDD-601.md': '---\nid: SDD-601\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-601"]\nimpacts_paths: ["src/601.ts"]\n---\ndesign\n\n## Tareas\n- [ ] pendiente\n',
    'src/601.ts': 'export const x = 601;\n',

    // PRD-602: approved + justified, blueprint's only work order is still pending -> only work_orders_done fails.
    'docs/business-case/BC-602.md': '---\nid: BC-602\ntype: BC\ntitle: "BC 602"\nstatus: approved\njustified_by: ["FB-602"]\n---\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
'docs/prd/PRD-602.md': '---\nid: PRD-602\ntype: PRD\ntitle: "Pending WO"\nstatus: approved\njustified_by: ["BC-602"]\n---\nproduct\n',
    'docs/feedback/FB-602.md': '---\nid: FB-602\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["PRD-602"]\n---\nfeedback\n',
    'docs/blueprints/SDD-602.md': '---\nid: SDD-602\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-602"]\nimpacts_paths: ["src/602.ts"]\n---\ndesign\n\n## Tareas\n- [x] hecho\n',
    'docs/work-orders/WO-602.md': '---\nid: WO-602\ntype: WO\ntitle: "Pending"\nstatus: pending\nimplements: ["SDD-602"]\nsource_task: "t602"\n---\nobjetivo\n',
    'src/602.ts': 'export const x = 602;\n',

    // PRD-603: draft (not approved) -- feature_approved can never be bypassed, whatever `bypass` claims.
    'docs/business-case/BC-603.md': '---\nid: BC-603\ntype: BC\ntitle: "BC 603"\nstatus: approved\njustified_by: ["FB-603"]\n---\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
'docs/prd/PRD-603.md': '---\nid: PRD-603\ntype: PRD\ntitle: "Draft"\nstatus: draft\njustified_by: ["BC-603"]\n---\nproduct\n',
    'docs/feedback/FB-603.md': '---\nid: FB-603\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["PRD-603"]\n---\nfeedback\n',

    // PRD-604: approved + justified, blueprint has no work order (same shape as PRD-601, kept separate
    // so the "wrong check bypassed" test doesn't depend on PRD-601's own already-closed state).
    'docs/business-case/BC-604.md': '---\nid: BC-604\ntype: BC\ntitle: "BC 604"\nstatus: approved\njustified_by: ["FB-604"]\n---\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
'docs/prd/PRD-604.md': '---\nid: PRD-604\ntype: PRD\ntitle: "No WOs 2"\nstatus: approved\njustified_by: ["BC-604"]\n---\nproduct\n',
    'docs/feedback/FB-604.md': '---\nid: FB-604\ntype: FB\ntitle: "Feedback"\nsource: email\nstatus: triaged\ninforms: ["PRD-604"]\n---\nfeedback\n',
    'docs/blueprints/SDD-604.md': '---\nid: SDD-604\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-604"]\nimpacts_paths: ["src/604.ts"]\n---\ndesign\n\n## Tareas\n- [ ] pendiente\n',
    'src/604.ts': 'export const x = 604;\n',
  };

  beforeAll(async () => {
    fcRoot = makeTmpDir('prdm-force-close-');
    writeFiles(fcRoot, FC_FILES);
    gitInit(fcRoot);
    commitAll(fcRoot, 'chore: initial docs');
    fcConfig = testConfig(fcRoot);
    ({ db: fcDb, store: fcStore } = await openTestDb(fcConfig));
    fcEngine = new Engine(fcConfig, fcStore);
    await fcEngine.refresh();
  });

  afterAll(async () => {
    await fcDb?.close();
    if (fcRoot) removeDir(fcRoot);
  });

  // NOTE on ordering: `project_clean` is a PROJECT-WIDE check (every error-level issue anywhere in the
  // project, not just this feature's own docs), so bypassing it doesn't fix the underlying issue -- it
  // stays reported afterwards and would fail `project_clean` for every OTHER feature's readiness check
  // too. The test that force-closes PRD-600 (introducing exactly that persisting issue) therefore runs
  // LAST in this shared-root block, after every test that needs project_clean genuinely clean.

  test('validates the "by" actor and requires a non-empty reason', async () => {
    await expect(forceCloseFeature(fcEngine, 'PRD-600', { by: 'not-an-actor', reason: 'x', bypass: ['project_clean'] })).rejects.toThrow(/invalid "by" actor/);
    await expect(forceCloseFeature(fcEngine, 'PRD-600', { by: 'dev:tester', reason: '', bypass: ['project_clean'] })).rejects.toThrow(/reason/i);
  });

  test('force-closes with blueprints_have_work_orders bypassed', async () => {
    const result = await forceCloseFeature(fcEngine, 'PRD-601', { by: 'dev:tester', reason: 'no WO needed here', bypass: ['blueprints_have_work_orders'] });
    expect(result.bypassed.map((b) => b.name)).toEqual(['blueprints_have_work_orders']);
    expect((await fcStore.getNode('PRD-601'))?.node.status).toBe('closed');
  });

  test('force-closes with work_orders_done bypassed', async () => {
    const result = await forceCloseFeature(fcEngine, 'PRD-602', { by: 'dev:tester', reason: 'ship without waiting', bypass: ['work_orders_done'] });
    expect(result.bypassed.map((b) => b.name)).toEqual(['work_orders_done']);
    expect((await fcStore.getNode('PRD-602'))?.node.status).toBe('closed');
  });

  test('throws when a non-bypassed check still fails alongside the bypassed one', async () => {
    // PRD-604 (blueprints_have_work_orders failing) with the WRONG check bypassed.
    await expect(forceCloseFeature(fcEngine, 'PRD-604', { by: 'dev:tester', reason: 'x', bypass: ['project_clean'] })).rejects.toThrow(/not ready to force-close/);
    expect((await fcStore.getNode('PRD-604'))?.node.status).not.toBe('closed');
  });

  test('force-closes with project_clean bypassed while a project-wide error issue exists', async () => {
    // project_clean is a PROJECT-WIDE check (every error-level issue anywhere in the project), so this
    // scenario gets its own isolated root/engine: bypassing it doesn't fix the underlying issue, which
    // would otherwise keep failing project_clean for every other feature sharing fcEngine's project.
    const pcRoot = makeTmpDir('prdm-force-close-project-clean-');
    const pcFiles: Record<string, string> = {
      'prdm.config.json': JSON.stringify({ ignore: [] }),
      'docs/prd/PRD-600.md': '---\nid: PRD-600\ntype: PRD\ntitle: "No justification"\nstatus: approved\n---\nproduct\n',
      'docs/blueprints/SDD-600.md': '---\nid: SDD-600\ntype: SDD\ntitle: "Design"\narchitects: ["PRD-600"]\nimpacts_paths: ["src/600.ts"]\n---\ndesign\n\n## Tareas\n- [x] hecho\n',
      'docs/work-orders/WO-600.md': '---\nid: WO-600\ntype: WO\ntitle: "Done"\nstatus: done\nimplements: ["SDD-600"]\nsource_task: "t600"\n---\nobjetivo\n',
      'src/600.ts': 'export const x = 600;\n',
    };
    writeFiles(pcRoot, pcFiles);
    gitInit(pcRoot);
    commitAll(pcRoot, 'chore: initial docs');
    const pcConfig = testConfig(pcRoot);
    const { db: pcDb, store: pcStore } = await openTestDb(pcConfig);
    const pcEngine = new Engine(pcConfig, pcStore);
    await pcEngine.refresh();
    try {
      const readiness = await closureReadiness(pcEngine, 'PRD-600');
      expect(readiness.ready).toBe(false);
      expect(readiness.checks.find((c) => c.name === 'project_clean')).toMatchObject({ ok: false });
      expect(readiness.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['project_clean']);

      const result = await forceCloseFeature(pcEngine, 'PRD-600', { by: 'dev:tester', reason: 'known issue, closing anyway', bypass: ['project_clean'] });
      expect(result.featureId).toBe('PRD-600');
      expect(result.reason).toBe('known issue, closing anyway');
      // Full check detail, not just the name, so the bypass is fully auditable.
      expect(result.bypassed).toEqual([expect.objectContaining({ name: 'project_clean', detail: expect.stringContaining('error-level issue') })]);

      expect((await pcStore.getNode('PRD-600'))?.node.status).toBe('closed');
    } finally {
      await pcDb.close();
      removeDir(pcRoot);
    }
  });

  test('feature_approved can never be bypassed, even naming it via an unsafe cast', async () => {
    const unsafeBypass = ['feature_approved', 'feature_exists', 'blueprints_have_work_orders', 'work_orders_done', 'project_clean'] as unknown as ForceCloseBypassableCheck[];
    await expect(forceCloseFeature(fcEngine, 'PRD-603', { by: 'dev:tester', reason: 'trying to force it anyway', bypass: unsafeBypass })).rejects.toThrow(/feature_approved/);
    expect((await fcStore.getNode('PRD-603'))?.node.status).not.toBe('closed');
  });

  test('feature_exists can never be bypassed, even naming it via an unsafe cast', async () => {
    const unsafeBypass = ['feature_exists', 'feature_approved', 'blueprints_have_work_orders', 'work_orders_done', 'project_clean'] as unknown as ForceCloseBypassableCheck[];
    await expect(forceCloseFeature(fcEngine, 'PRD-999', { by: 'dev:tester', reason: 'trying to force it anyway', bypass: unsafeBypass })).rejects.toThrow(/feature_exists/);
  });

  test('TypeScript statically rejects naming feature_exists/feature_approved in bypass (compile-time enforcement)', () => {
    // ForceCloseBypassableCheck is an explicit 3-member literal union (blueprints_have_work_orders |
    // work_orders_done | project_clean) -- feature_exists/feature_approved are structurally impossible to
    // name without an unsafe cast, proven here at compile time (the line below fails typecheck without
    // the ts-expect-error, since 'feature_exists' isn't assignable to ForceCloseBypassableCheck).
    // @ts-expect-error 'feature_exists' is not a ForceCloseBypassableCheck
    const invalidBypass: ForceCloseBypassableCheck[] = ['feature_exists'];
    void invalidBypass;
    expect(true).toBe(true);
  });
});
