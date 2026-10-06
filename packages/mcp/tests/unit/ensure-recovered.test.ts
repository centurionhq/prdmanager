import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, test } from 'vitest';
import type { AuthoringService, Engine, GraphStore, PrdmConfig } from '@prdm/core';
import { registerAuthoringTools } from '../../src/tools-authoring.js';
import { registerPrdmResources } from '../../src/resources.js';
import { registerReadTools } from '../../src/tools-read.js';
import type { PrdmDeps } from '../../src/deps.js';

/**
 * SDD-002 "Transacción atómica" (WO-025): a read never goes through `engine.transaction()`, so without an
 * explicit recovery step it could silently serve data left stale by a crashed process (planted `.prdm/graph-stale`
 * marker). These tests use a spy/fake engine to prove every read tool/resource calls `engine.recover()` — and
 * calls it *before* touching the store — instead of standing up a real Neo4j-backed engine.
 */
function trackedDeps(calls: string[]): PrdmDeps {
  const store: GraphStore = {
    clear: async () => undefined,
    writeSnapshot: async () => undefined,
    getNode: async (id: string) => {
      calls.push('store.getNode');
      return { node: { id, label: 'Feature', kind: 'PRD', title: 't', status: 'draft', body: '', tags: [], source_path: 'x.md', mirrorPath: '.prdm/remote/docs/' + id + '.md', created_at: null }, links: [] };
    },
    search: async () => {
      calls.push('store.search');
      return [];
    },
    branch: async () => {
      calls.push('store.branch');
      return { nodes: [], edges: [] };
    },
    fullGraph: async () => {
      calls.push('store.fullGraph');
      return { nodes: [], edges: [] };
    },
    queryWorkOrders: async () => {
      calls.push('store.queryWorkOrders');
      return { items: [], total: 0, statusCounts: { all: 0, pending: 0, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 } };
    },
    listWorkOrders: async () => {
      calls.push('store.listWorkOrders');
      return [];
    },
    workOrderContext: async () => {
      calls.push('store.workOrderContext');
      return null;
    },
    metricsRaw: async () => {
      calls.push('store.metricsRaw');
      return { governedTotal: 0, governedSynced: 0, featuresTotal: 0, featuresTraced: 0, orphanFeatures: [], commitsTotal: 0, commitsWithRefs: 0, commitsTraced: 0, workOrders: [] };
    },
    untracedCommits: async () => {
      calls.push('store.untracedCommits');
      return { total: 0, danglingRefs: 0, truncated: false, items: [] };
    },
  };

  const engine = {
    config: { root: '/repo', ignore: [] },
    recover: async () => {
      calls.push('engine.recover');
    },
    scan: async () => {
      calls.push('engine.scan');
      return { docs: [], errors: [], ids: [] };
    },
  } as unknown as Engine;

  const authoring = {
    list: () => {
      calls.push('authoring.list');
      return [];
    },
    validate: async (draftId: string) => {
      calls.push('authoring.validate');
      return { draftId, revision: 0, issues: [] };
    },
  } as unknown as AuthoringService;

  const config = {
    project: { id: 'prj_0000000000000000', name: 'Recover Test', root: '/repo' },
    folders: {},
    authoring: { maxDraftBytes: 200_000 },
  } as unknown as PrdmConfig;

  return { config, store, engine, authoring };
}

async function connect(register: (server: McpServer, deps: PrdmDeps) => void, deps: PrdmDeps): Promise<{ client: Client; server: McpServer }> {
  const server = new McpServer({ name: 'recover-test', version: '0.0.0' });
  register(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'recover-test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe('ensureRecovered is called before every read tool/resource serves data (WO-025)', () => {
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
  });

  test('get_node recovers before reading the store', async () => {
    const calls: string[] = [];
    ({ client, server } = await connect(registerReadTools, trackedDeps(calls)));
    await client.callTool({ name: 'get_node', arguments: { id: 'PRD-001' } });
    expect(calls).toEqual(['engine.recover', 'store.getNode']);
  });

  test('search_nodes, get_feature_branch, get_feature_tree, list_work_orders, get_work_order_context and get_metrics all recover first', async () => {
    const calls: string[] = [];
    ({ client, server } = await connect(registerReadTools, trackedDeps(calls)));

    await client.callTool({ name: 'search_nodes', arguments: { query: 'x' } });
    await client.callTool({ name: 'get_feature_branch', arguments: { id: 'PRD-001' } }).catch(() => undefined); // empty subgraph -> isError, still recovers first
    await client.callTool({ name: 'get_feature_tree', arguments: {} });
    await client.callTool({ name: 'list_work_orders', arguments: {} });
    await client.callTool({ name: 'get_work_order_context', arguments: { id: 'WO-001' } });
    await client.callTool({ name: 'get_metrics', arguments: {} });

    const recoverCount = calls.filter((c) => c === 'engine.recover').length;
    expect(recoverCount).toBe(6);
    // `get_metrics` hace dos lecturas: cada recover abre un grupo y ninguna lectura queda fuera de uno.
    expect(calls[0]).toBe('engine.recover');
    calls.forEach((call, i) => {
      if (call === 'engine.recover') expect(calls[i + 1]).toMatch(/^store\./);
      else expect(calls[i - 1]).toMatch(/^(engine\.recover|store\.)/);
    });
  });

  test('get_project and list_drafts (authoring read tools) recover before reading', async () => {
    const calls: string[] = [];
    ({ client, server } = await connect(registerAuthoringTools, trackedDeps(calls)));

    await client.callTool({ name: 'get_project', arguments: {} });
    expect(calls[0]).toBe('engine.recover');

    calls.length = 0;
    await client.callTool({ name: 'list_drafts', arguments: {} });
    expect(calls).toEqual(['engine.recover', 'authoring.list']);
  });

  test('validate_draft recovers before validating', async () => {
    const calls: string[] = [];
    ({ client, server } = await connect(registerAuthoringTools, trackedDeps(calls)));
    await client.callTool({ name: 'validate_draft', arguments: { draft_id: 'd1' } });
    expect(calls).toEqual(['engine.recover', 'authoring.validate']);
  });

  test('graph-node and project resources recover before reading', async () => {
    const calls: string[] = [];
    ({ client, server } = await connect(registerPrdmResources, trackedDeps(calls)));

    await client.readResource({ uri: 'graph://node/PRD-001' });
    expect(calls).toEqual(['engine.recover', 'store.getNode']);

    calls.length = 0;
    await client.readResource({ uri: 'prdm://project' });
    expect(calls[0]).toBe('engine.recover');
  });
});
