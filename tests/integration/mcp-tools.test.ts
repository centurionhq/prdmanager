import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import type { Neo4jGraphStore } from '../../src/graph/store.js';
import { createPrdmServer } from '../../src/mcp/create.js';
import { openTestStore, testConfig } from '../helpers/db.js';
import { createFixtureRepo } from '../helpers/fixture.js';
import { git, removeDir, writeFiles } from '../helpers/tmp.js';

const EXPECTED_TOOLS = [
  'get_node',
  'search_nodes',
  'get_feature_branch',
  'get_feature_tree',
  'list_work_orders',
  'get_work_order_context',
  'triage_feedback',
  'get_metrics',
  'get_drift_report',
  'acknowledge_sync',
  'refresh_index',
  'generate_work_orders',
  'claim_work_order',
  'complete_work_order',
  'submit_feedback',
  'create_feature_request',
  'attach_artifact',
];

function textOf(result: unknown): string {
  const { content } = result as CallToolResult;
  const first = content[0];
  if (!first || first.type !== 'text') throw new Error('expected text content');
  return first.text;
}

function json(result: unknown): any {
  return JSON.parse(textOf(result));
}

let root: string;
let config: PrdmConfig;
let store: Neo4jGraphStore;
let engine: Engine;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  store = await openTestStore(config);
  engine = new Engine(config, store);
  await engine.refresh();

  server = createPrdmServer({ config, store, engine });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
  await store?.close();
  if (root) removeDir(root);
});

describe('prdm-graph MCP tools', () => {
  test('tools/list exposes every tool with an input schema and annotations', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) expect(names).toContain(expected);

    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
      expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations?.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations?.idempotentHint).toBe('boolean');
    }
  });

  test('get_feature_branch renders the text lineage from MRD-001 down to WO-001', async () => {
    const result = await client.callTool({ name: 'get_feature_branch', arguments: { id: 'WO-001' } });
    const text = textOf(result as CallToolResult);
    expect(text).toMatch(/MRD-001[\s\S]*PRD-001[\s\S]*SDD-001[\s\S]*WO-001/);
  });

  test('get_feature_branch in mermaid/json formats and get_feature_tree work', async () => {
    const mermaid = await client.callTool({ name: 'get_feature_branch', arguments: { id: 'WO-001', format: 'mermaid' } });
    expect(textOf(mermaid as CallToolResult)).toContain('flowchart TD');

    const asJson = await client.callTool({ name: 'get_feature_branch', arguments: { id: 'WO-001', format: 'json' } });
    const subgraph = json(asJson as CallToolResult);
    expect(subgraph.nodes.some((n: { ref: string }) => n.ref === 'WO-001')).toBe(true);

    const tree = await client.callTool({ name: 'get_feature_tree', arguments: {} });
    expect(textOf(tree as CallToolResult)).toContain('MRD-001');
  });

  test('search_nodes finds nodes by full-text query', async () => {
    const result = await client.callTool({ name: 'search_nodes', arguments: { query: 'grafos', label: 'Feature' } });
    const { results } = json(result as CallToolResult);
    expect(results.some((r: { id: string }) => r.id === 'PRD-001')).toBe(true);
  });

  test('full work order flow: generate -> claim -> context -> complete -> list', async () => {
    const generated = json(await client.callTool({ name: 'generate_work_orders', arguments: { blueprint_id: 'SDD-001' } }));
    expect(generated.created.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['WO-002', 'WO-003']));

    const claimed = json(await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-002', assignee: 'agent:claude' } }));
    expect(claimed).toMatchObject({ id: 'WO-002', status: 'in_progress', assignedTo: 'agent:claude' });

    const context = json(await client.callTool({ name: 'get_work_order_context', arguments: { id: 'WO-002' } }));
    expect(context.blueprints.map((b: { id: string }) => b.id)).toEqual(['SDD-001']);
    expect(context.featureLineage.map((f: { id: string }) => f.id).sort()).toEqual(['MRD-001', 'PRD-001']);

    const headSha = git(root, 'rev-parse', 'HEAD').trim();
    const completed = json(await client.callTool({ name: 'complete_work_order', arguments: { id: 'WO-002', commit_sha: headSha } }));
    expect(completed).toMatchObject({ id: 'WO-002', status: 'done' });

    const list = json(await client.callTool({ name: 'list_work_orders', arguments: { status: 'done' } }));
    expect(list.results.map((w: { id: string }) => w.id)).toContain('WO-002');
  });

  test('get_drift_report reports blueprint_changed after an edit, acknowledge_sync clears it', async () => {
    const clean = json(await client.callTool({ name: 'get_drift_report', arguments: {} }));
    expect(clean.hasBlockingIssues).toBe(false);

    const sddPath = `${root}/docs/blueprints/SDD-001.md`;
    writeFiles(root, { 'docs/blueprints/SDD-001.md': readFileSync(sddPath, 'utf8').replace('compara hashes', 'compara hashes y firmas') });

    const drift = json(await client.callTool({ name: 'refresh_index', arguments: {} }));
    expect(drift.issues.some((i: { kind: string; nodeId: string }) => i.kind === 'blueprint_changed' && i.nodeId === 'SDD-001')).toBe(true);
    expect(drift.hasBlockingIssues).toBe(true);

    const acked = json(await client.callTool({ name: 'acknowledge_sync', arguments: { target: 'SDD-001' } }));
    expect(acked.issues).toEqual([]);
    expect(acked.hasBlockingIssues).toBe(false);
  });

  test('submit_feedback triages by score, triage_feedback proposes, create_feature_request promotes it', async () => {
    const linked = json(
      await client.callTool({
        name: 'submit_feedback',
        arguments: { text: 'Quiero alertas cuando haya desincronización entre el blueprint y el código', source: 'chat' },
      }),
    );
    expect(linked.reason).toBe('score');
    expect(linked.linkedTo).toEqual(['PRD-001']);

    const triaged = json(await client.callTool({ name: 'triage_feedback', arguments: { text: 'el botón de login es azul' } }));
    expect(triaged.reason).toBe('none');
    expect(triaged.proposal?.title).toBe('el botón de login es azul');

    const unlinked = json(await client.callTool({ name: 'submit_feedback', arguments: { text: 'el botón de login es azul', source: 'chat' } }));
    expect(unlinked.linkedTo).toEqual([]);

    const fr = json(
      await client.callTool({
        name: 'create_feature_request',
        arguments: { title: 'Personalizar color del botón', description: 'Cambiar el color del botón de login', parent_id: 'PRD-001', feedback_id: unlinked.id },
      }),
    );
    expect(fr).toMatchObject({ parentId: 'PRD-001', feedbackId: unlinked.id });
  });

  test('attach_artifact links inline content to a matching Feature', async () => {
    const result = json(await client.callTool({ name: 'attach_artifact', arguments: { title: 'Nota de reunión', content: 'Contexto sobre PRD-001.', source: 'meeting' } }));
    expect(result.linkedTo).toEqual(['PRD-001']);
  });

  test('get_metrics returns the three success-metric sections', async () => {
    const metrics = json(await client.callTool({ name: 'get_metrics', arguments: {} }));
    expect(metrics).toHaveProperty('agentHumanEfficiency');
    expect(metrics).toHaveProperty('systemIntegrity');
    expect(metrics).toHaveProperty('traceability');
  });

  test('errors come back as isError with a plain message and no stack trace', async () => {
    const unknownId = (await client.callTool({ name: 'get_node', arguments: { id: 'PRD-404' } })) as CallToolResult;
    expect(unknownId.isError).toBe(true);
    expect(textOf(unknownId)).toMatch(/not found/);
    expect(textOf(unknownId)).not.toMatch(/\n\s*at /);

    const invalidAssignee = (await client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: 'not-an-actor' } })) as CallToolResult;
    expect(invalidAssignee.isError).toBe(true);
    expect(textOf(invalidAssignee)).not.toMatch(/\n\s*at /);

    const invalidLabel = (await client.callTool({ name: 'search_nodes', arguments: { query: 'x', label: 'NotALabel' } })) as CallToolResult;
    expect(invalidLabel.isError).toBe(true);
    expect(textOf(invalidLabel)).not.toMatch(/\n\s*at /);
  });

  test('resources/read returns graph://node/PRD-001 as JSON', async () => {
    const result = await client.readResource({ uri: 'graph://node/PRD-001' });
    const first = result.contents[0] as { mimeType?: string; text?: string };
    expect(first.mimeType).toBe('application/json');
    const parsed = JSON.parse(first.text ?? '{}');
    expect(parsed.node).toMatchObject({ id: 'PRD-001', label: 'Feature' });
  });

  test('prompts/get implement_work_order returns instructions and the context bundle', async () => {
    const result = await client.getPrompt({ name: 'implement_work_order', arguments: { id: 'WO-001' } });
    const message = result.messages[0] as { content: { type: string; text: string } };
    expect(message.content.text).toContain('Refs: WO-001');
    expect(message.content.text).toContain('"id": "WO-001"');
  });
});
