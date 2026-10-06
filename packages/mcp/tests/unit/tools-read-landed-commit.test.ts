import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, test } from 'vitest';
import { mirrorPathFor, type Engine, type GraphStore } from '@prdm/core';
import { registerReadTools } from '../../src/tools-read.js';
import type { PrdmDeps } from '../../src/deps.js';

const SHA = 'b'.repeat(40);

function deps(): PrdmDeps {
  const item = (id: string) => ({ id, title: 't', status: 'pending', assignedTo: null, blueprints: [], sourcePath: `docs/work-orders/${id}.md`, mirrorPath: mirrorPathFor(id) });
  const store = {
    listWorkOrders: async () => [{ ...item('WO-001'), landedCommitSha: SHA }, item('WO-002')],
  } as unknown as GraphStore;
  const engine = { recover: async () => undefined } as unknown as Engine;
  return { store, engine } as unknown as PrdmDeps;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content[0]?.text ?? '';
}

describe('list_work_orders publishes landedCommitSha (SDD-076 D2)', () => {
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connect(): Promise<Client> {
    server = new McpServer({ name: 'landed-test', version: '0.0.0' });
    registerReadTools(server, deps());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'landed-test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  test('items carry landedCommitSha, null when the store does not bring it', async () => {
    const c = await connect();
    const payload = JSON.parse(textOf(await c.callTool({ name: 'list_work_orders', arguments: {} })));
    expect(payload.results[0].landedCommitSha).toBe(SHA);
    expect(payload.results[1].landedCommitSha ?? null).toBeNull();
  });

  test('description mentions landedCommitSha', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const description = tools.find((t) => t.name === 'list_work_orders')?.description ?? '';
    expect(description).toContain('landedCommitSha');
  });
});
