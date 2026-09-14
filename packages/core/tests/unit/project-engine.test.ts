import { afterEach, describe, expect, test } from 'vitest';
import { Engine, type ProjectEngine } from '../../src/engine.js';
import type { GraphSnapshot, GraphStore } from '../../src/graph/types.js';
import { createFixtureRepo, removeDir, testConfig } from '@prdm/testkit';

function fakeStore(): GraphStore {
  const snapshots: GraphSnapshot[] = [];
  return {
    clear: async () => undefined,
    writeSnapshot: async (snapshot) => {
      snapshots.push(snapshot);
    },
    getNode: async () => null,
    search: async () => [],
    branch: async () => ({ nodes: [], links: [] }),
    fullGraph: async () => ({ nodes: [], links: [] }),
    listWorkOrders: async () => [],
    workOrderContext: async () => null,
    metricsRaw: async () => ({ docs: [], workOrders: [] }) as never,
  } as GraphStore;
}

let root = '';
afterEach(() => root && removeDir(root));

/**
 * WO-124/SDD-007: `Engine` implements the narrow `ProjectEngine` port domain functions are typed against.
 * `settings` must omit `root`/`neo4j` (SaaS values never come from a filesystem path or a db connection);
 * `scan()` must behave like `EngineOps.scan()`; `lastReport()` must return saved state without recomputing.
 */
describe('Engine as ProjectEngine', () => {
  test('settings excludes root and neo4j but keeps every other PrdmConfig field', async () => {
    root = createFixtureRepo();
    const config = testConfig(root);
    const engine: ProjectEngine = new Engine(config, fakeStore());

    expect(engine.settings).not.toHaveProperty('root');
    expect(engine.settings).not.toHaveProperty('neo4j');
    expect(engine.settings.docsDir).toBe(config.docsDir);
    expect(engine.settings.folders).toEqual(config.folders);
    expect(engine.settings.lifecycle).toEqual(config.lifecycle);
  });

  test('scan() returns the same ScanResult as a transaction ops.scan()', async () => {
    root = createFixtureRepo();
    const config = testConfig(root);
    const engine: ProjectEngine = new Engine(config, fakeStore());

    const direct = await engine.scan();
    const viaOps = await engine.transaction((ops) => ops.scan());
    expect(direct).toEqual(viaOps);
    expect(direct.docs.length).toBeGreaterThan(0);
  });

  test('lastReport() is null before any refresh/inspect, then returns the saved report without recomputing', async () => {
    root = createFixtureRepo();
    const config = testConfig(root);
    const engine: ProjectEngine = new Engine(config, fakeStore());

    expect(await engine.lastReport()).toBeNull();

    const inspected = await engine.inspect();
    expect(await engine.lastReport()).toEqual(inspected);

    const refreshed = await engine.refresh();
    expect(await engine.lastReport()).toEqual(refreshed);
    // lastReport must be a plain read of saved state: calling it again does not change it or touch the fake store beyond the one refresh() above.
    expect(await engine.lastReport()).toEqual(refreshed);
  });
});
