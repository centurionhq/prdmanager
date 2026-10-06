import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, test } from 'vitest';
import { mirrorPathFor, type Engine, type GraphStore } from '@prdm/core';
import { registerReadTools } from '../../src/tools-read.js';
import type { PrdmDeps } from '../../src/deps.js';

const SOURCE_PATH = 'docs/work-orders/WO-001.md';

function deps(): PrdmDeps {
  const store = {
    getNode: async (id: string) => ({
      node: { id, label: 'WorkOrder', kind: 'WO', title: 't', status: 'pending', body: '', tags: [], source_path: SOURCE_PATH, mirrorPath: mirrorPathFor(id), created_at: null },
      links: [],
    }),
    listWorkOrders: async () => [
      { id: 'WO-001', title: 't', status: 'pending', assignedTo: null, blueprints: [], sourcePath: SOURCE_PATH, mirrorPath: mirrorPathFor('WO-001') },
    ],
  } as unknown as GraphStore;
  const engine = { recover: async () => undefined } as unknown as Engine;
  return { store, engine } as unknown as PrdmDeps;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content[0]?.text ?? '';
}

describe('read tools publish mirrorPath next to the canonical path (SDD-074)', () => {
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connect(): Promise<Client> {
    server = new McpServer({ name: 'mirror-test', version: '0.0.0' });
    registerReadTools(server, deps());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'mirror-test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  test('list_work_orders items carry sourcePath and mirrorPath', async () => {
    const c = await connect();
    const payload = JSON.parse(textOf(await c.callTool({ name: 'list_work_orders', arguments: {} })));
    const item = payload.results[0];
    expect(item.sourcePath).toBe(SOURCE_PATH);
    expect(item.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
  });

  test('get_node returns mirrorPath beside source_path', async () => {
    const c = await connect();
    const payload = JSON.parse(textOf(await c.callTool({ name: 'get_node', arguments: { id: 'WO-001' } })));
    expect(payload.node.source_path).toBe(SOURCE_PATH);
    expect(payload.node.mirrorPath).toBe('.prdm/remote/docs/WO-001.md');
  });

  test('tool descriptions explain canonical vs readable paths', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const description = (name: string) => tools.find((t) => t.name === name)?.description ?? '';
    expect(description('get_node')).toContain('source_path');
    expect(description('get_node')).toContain('mirrorPath');
    expect(description('list_work_orders')).toContain('sourcePath');
    expect(description('list_work_orders')).toContain('mirrorPath');
  });
});
