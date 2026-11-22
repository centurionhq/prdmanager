import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, test } from 'vitest';
import type { Engine, GraphStore, MetricsRaw, PrdmConfig, ScanResult, UntracedCommits } from '@prdm/core';
import { doc } from '@prdm/testkit';
import { registerReadTools } from '../../src/tools-read.js';
import type { PrdmDeps } from '../../src/deps.js';

/** SDD-126 D3 (WO-814): `get_metrics` publica `capacities` y su descripción declara las sumas que cierran. */

const TODAY = new Date().toISOString();
const FR = doc(`id: FR-001\ntype: FR\ntitle: Pedido\nstatus: approved\ncreated_at: ${TODAY}`);
const SDD = doc('id: SDD-001\ntype: SDD\ntitle: Diseño\narchitects: [FR-001]\nimpacts_paths: ["src/**"]');
const DOCS = [FR, SDD];

const RAW: MetricsRaw = {
  governedTotal: 0,
  governedSynced: 0,
  features: [],
  commitsTotal: 0,
  commitsWithRefs: 0,
  commitsTraced: 0,
  workOrders: [],
  commitsBranch: null,
  commitsSha: null,
  commitsReportedAt: null,
};

const UNTRACED: UntracedCommits = {
  total: 0,
  danglingRefs: 0,
  byClass: { merge: 0, bookkeeping: 0, code: 0 },
  truncated: false,
  items: [],
};

function deps(): PrdmDeps {
  const store = { metricsRaw: async () => RAW, untracedCommits: async () => UNTRACED } as unknown as GraphStore;
  const engine = {
    recover: async () => undefined,
    scan: async (): Promise<ScanResult> => ({ docs: DOCS, errors: [], ids: DOCS.map((d) => d.node.id) }),
  } as unknown as Engine;
  const config = { lifecycle: { grandfathered: [] } } as unknown as PrdmConfig;
  return { store, engine, config };
}

interface CapacityWindow {
  days: number;
  createdByKind: { kind: string; total: number }[];
}

describe('get_metrics publishes capacities (SDD-126 D3)', () => {
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
  });

  async function connect(): Promise<Client> {
    server = new McpServer({ name: 'capacities-test', version: '0.0.0' });
    registerReadTools(server, deps());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'capacities-test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  test('the payload carries both windows, all 7 kinds, and the FR created today in the 7-day window', async () => {
    const c = await connect();
    const result = await c.callTool({ name: 'get_metrics', arguments: {} });
    const content = result.content as { type: string; text?: string }[];
    const payload = JSON.parse(content[0]?.text ?? '') as { capacities: { windows: CapacityWindow[] } };
    const { windows } = payload.capacities;
    expect(windows.map((w) => w.days)).toEqual([7, 30]);
    expect(windows[0]?.createdByKind).toHaveLength(7);
    expect(windows[0]?.createdByKind.find((k) => k.kind === 'FR')?.total).toBe(1);
  });

  test('the description states the closing sums', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const description = tools.find((t) => t.name === 'get_metrics')?.description ?? '';
    expect(description).toContain('feedback.new + feedback.triaged + feedback.closed = feedback.created');
  });
});
