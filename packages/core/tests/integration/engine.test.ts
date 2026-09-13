import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import type { Neo4jGraphStore } from '../../src/graph/store.js';
import { buildForest, renderMermaid, renderText } from '../../src/graph/tree.js';
import { commitAll, createFixtureRepo, openTestStore, removeDir, testConfig, writeFiles } from '@prdm/testkit';

let root: string;
let config: PrdmConfig;
let store: Neo4jGraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  store = await openTestStore(config);
  engine = new Engine(config, store);
});

afterAll(async () => {
  await store?.close();
  if (root) removeDir(root);
});

describe('Engine + Neo4jGraphStore', () => {
  test('first refresh indexes the repository into Neo4j with no drift', async () => {
    const report = await engine.refresh();
    expect(report.errors).toEqual([]);
    expect(report.issues).toEqual([]);
    expect(report.documents).toBe(5);
    expect(report.baselineWritten).toBe(true);

    const sdd = await store.getNode('SDD-001');
    expect(sdd?.node).toMatchObject({ id: 'SDD-001', label: 'Blueprint', title: 'Arquitectura del Sync Monitor' });
    expect(sdd?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ARCHITECTS', direction: 'out', ref: 'PRD-001' }),
        expect.objectContaining({ type: 'IMPLEMENTS', direction: 'in', ref: 'WO-001' }),
        expect.objectContaining({ type: 'GOVERNED_BY', direction: 'in', ref: 'code:src/sync/monitor.ts', props: expect.objectContaining({ status: 'synced' }) }),
      ]),
    );
    const wo = await store.getNode('WO-001');
    expect(wo?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ASSIGNED_TO', direction: 'out', ref: 'actor:agent:claude' }),
        expect.objectContaining({ type: 'RESOLVES', direction: 'in' }),
      ]),
    );
    expect(await store.getNode('PRD-404')).toBeNull();
  });

  test('reconstructs the full branch of a work order from the root down to code', async () => {
    const forest = buildForest(await store.branch('WO-001'));
    expect(forest.map((n) => n.ref)).toEqual(['MRD-001']);
    const text = renderText(forest);
    expect(text).toMatch(/MRD-001[\s\S]*PRD-001[\s\S]*SDD-001[\s\S]*WO-001[\s\S]*commit:/);
    expect(text).not.toContain('ART-001');

    const prdBranch = buildForest(await store.branch('PRD-001'));
    const prdText = renderText(prdBranch);
    expect(prdText).toContain('ART-001');
    expect(prdText).toContain('code:src/sync/monitor.ts');
    expect(renderMermaid(prdBranch)).toMatch(/^flowchart TD/);
    expect(await store.branch('PRD-404')).toEqual({ nodes: [], edges: [] });
  });

  test('full-text search finds documents by content and filters by label', async () => {
    const hits = await store.search('desincronización', { labels: ['Feature'], limit: 5 });
    expect(hits[0]).toMatchObject({ id: 'PRD-001', label: 'Feature' });
    expect(await store.search('drift', { labels: ['Blueprint'], limit: 5 })).toEqual([]);
  });

  test('blueprint change marks work orders and code out of sync, acknowledge restores sync', async () => {
    const sddPath = join(root, 'docs/blueprints/SDD-001.md');
    writeFiles(root, { 'docs/blueprints/SDD-001.md': readFileSync(sddPath, 'utf8').replace('compara hashes', 'compara hashes y firmas') });

    const drift = await engine.refresh();
    expect(drift.issues.map((i) => i.kind)).toEqual(['blueprint_changed', 'code_out_of_sync', 'work_order_out_of_sync']);
    expect(drift.workOrderUpdates).toEqual([{ id: 'WO-001', sourcePath: 'docs/work-orders/WO-001.md', from: 'done', to: 'out_of_sync' }]);
    expect(readFileSync(join(root, 'docs/work-orders/WO-001.md'), 'utf8')).toContain('status: "out_of_sync"');
    expect((await store.getNode('WO-001'))?.node.status).toBe('out_of_sync');
    const sdd = await store.getNode('SDD-001');
    expect(sdd?.links.find((l) => l.type === 'GOVERNED_BY')?.props).toMatchObject({ status: 'out_of_sync', reason: 'blueprint_changed' });

    const blueprintAcked = await engine.acknowledge('SDD-001');
    expect(blueprintAcked.issues.map((i) => [i.kind, i.nodeId])).toEqual([['work_order_out_of_sync', 'WO-001']]);
    expect((await store.getNode('WO-001'))?.node.status).toBe('out_of_sync');

    await expect(engine.acknowledge('WO-404')).rejects.toThrow(/unknown/);
    const acked = await engine.acknowledge('WO-001');
    expect(acked.issues).toEqual([]);
    expect((await store.getNode('WO-001'))?.node.status).toBe('done');
    expect(readFileSync(join(root, 'docs/work-orders/WO-001.md'), 'utf8')).toMatch(/blueprint_hashes: \{"SDD-001":"[0-9a-f]{64}"\}/);
  });

  test('code change is out of sync until committed with a Refs trailer of a done work order', async () => {
    writeFiles(root, { 'src/sync/monitor.ts': 'export function detect() {\n  return 2;\n}\n' });
    const dirty = await engine.refresh();
    expect(dirty.issues.map((i) => [i.kind, i.target])).toEqual([['code_out_of_sync', 'src/sync/monitor.ts']]);

    commitAll(root, 'fix: detect returns 2\n\nRefs: WO-001');
    const committed = await engine.refresh();
    expect(committed.issues).toEqual([]);
    expect(committed.governed.find((g) => g.key === 'src/sync/monitor.ts')?.reason).toBe('resolved_by_commit');
  });

  test('removing a document removes its node and reports the resulting broken link', async () => {
    rmSync(join(root, 'docs/artifacts/ART-001.md'));
    writeFiles(root, { 'docs/feedback/FB-001.md': '---\nid: FB-001\ntype: FB\ntitle: x\nsource: email\ninforms: [PRD-404]\n---\nx\n' });
    const report = await engine.refresh();
    expect(await store.getNode('ART-001')).toBeNull();
    expect(report.issues.map((i) => [i.kind, i.nodeId])).toEqual([['broken_link', 'FB-001']]);
    expect(report.hasBlockingIssues).toBe(true);
  });

  test('computes success metrics from the graph', async () => {
    const metrics = await store.metricsRaw();
    expect(metrics.governedTotal).toBe(1);
    expect(metrics.governedSynced).toBe(1);
    expect(metrics.featuresTotal).toBe(2);
    expect(metrics.featuresTraced).toBe(2);
    expect(metrics.commitsTotal).toBe(2);
    expect(metrics.commitsTraced).toBe(2);
    expect(metrics.workOrders).toEqual([{ id: 'WO-001', status: 'done', claimedAt: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-10T14:00:00.000Z' }]);
  });
});
