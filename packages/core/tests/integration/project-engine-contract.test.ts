/**
 * Runs the shared `ProjectEngine` contract suite (SDD-007 "Tests"; WO-135) against the local,
 * disk-backed `Engine` — the counterpart to `packages/server/tests/integration/pg-project-engine-*`,
 * which runs the exact same suite against `PgProjectEngine`.
 */
import { Engine } from '../../src/engine.js';
import type { GraphSnapshot, GraphStore } from '../../src/graph/types.js';
import { commitAll, gitInit, makeTmpDir, removeDir, runProjectEngineContractTests, testConfig, writeFiles } from '@prdm/testkit';

/** Same in-memory recorder `project-engine.test.ts` already uses: `Engine`'s own writes go straight to
 * disk, so nothing here needs a real Neo4j connection for this suite to exercise real behavior. */
function fakeStore(): GraphStore {
  const snapshots: GraphSnapshot[] = [];
  return {
    clear: async () => undefined,
    writeSnapshot: async (snapshot) => {
      snapshots.push(snapshot);
    },
    getNode: async () => null,
    search: async () => [],
    branch: async () => ({ nodes: [], edges: [] }),
    fullGraph: async () => ({ nodes: [], edges: [] }),
    listWorkOrders: async () => [],
    queryWorkOrders: async () => ({ items: [], total: 0, statusCounts: { all: 0, pending: 0, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 } }),
    workOrderContext: async () => null,
    metricsRaw: async () => ({ docs: [], workOrders: [] }) as never,
  };
}

runProjectEngineContractTests(async () => {
  const root = makeTmpDir('prdm-contract-');
  writeFiles(root, { 'prdm.config.json': JSON.stringify({ ignore: [] }) });
  gitInit(root);
  commitAll(root, 'chore: init fixture repo');

  const config = testConfig(root);
  const engine = new Engine(config, fakeStore());

  return {
    engine,
    seedDocument: async (relPath, content) => {
      writeFiles(root, { [relPath]: content });
    },
    commitReferencing: async (id) => commitAll(root, `chore: work on ${id}\n\nRefs: ${id}`),
    cleanup: async () => removeDir(root),
  };
});
