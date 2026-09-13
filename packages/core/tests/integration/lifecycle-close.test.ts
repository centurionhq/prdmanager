import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeFeature, closureReadiness, Engine, type GraphStore, type Neo4jGraphDatabase, type PrdmConfig } from '@prdm/core';
import { commitAll, gitInit, makeTmpDir, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';

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
