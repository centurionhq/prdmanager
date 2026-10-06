import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, test } from 'vitest';
import { mirrorPathFor, type Engine, type GraphStore } from '@prdm/core';
import { registerReadTools } from '../../src/tools-read.js';
import type { PrdmDeps } from '../../src/deps.js';

function deps(): PrdmDeps {
  const store = {
    listWorkOrders: async () => [
      {
        id: 'WO-001', title: 't', status: 'pending', assignedTo: null, blueprints: [], sourcePath: 'docs/work-orders/WO-001.md',
        mirrorPath: mirrorPathFor('WO-001'), createdAt: '2020-01-01', claimedAt: null, ageDays: 2100,
      },
    ],
  } as unknown as GraphStore;
  const engine = { recover: async () => undefined } as unknown as Engine;
  return { store, engine } as unknown as PrdmDeps;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content[0]?.text ?? '';
}

describe('list_work_orders publishes dates and age (SDD-075)', () => {
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connect(): Promise<Client> {
    server = new McpServer({ name: 'dates-test', version: '0.0.0' });
    registerReadTools(server, deps());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'dates-test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  test('items carry createdAt, claimedAt and ageDays', async () => {
    const c = await connect();
    const payload = JSON.parse(textOf(await c.callTool({ name: 'list_work_orders', arguments: {} })));
    const item = payload.results[0];
    expect(item.createdAt).toBe('2020-01-01');
    expect(item.claimedAt).toBeNull();
    expect(item.ageDays).toBe(2100);
  });

  test('description explains ageDays and that assignedTo is null until claimed', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const description = tools.find((t) => t.name === 'list_work_orders')?.description ?? '';
    expect(description).toContain('ageDays');
    expect(description).toContain('assignedTo is null');
  });
});
