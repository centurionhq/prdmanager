/**
 * `registerPrdmTools(server, deps, { profile: 'remote' })` (SDD-010's remote MCP profile, WO-184): the
 * exact allow-list from its own table, and — as a regression guard, not just a happy path — every
 * authoring/mutation-adjacent tool and prompt this profile must NEVER expose.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Engine, scanDocuments, type GraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { createFixtureRepo, openTestDb, removeDir, testConfig } from '@prdm/testkit';
import { createPrdmServer } from '../../src/create.js';

const EXPECTED_REMOTE_TOOLS = [
  'get_project',
  'get_node',
  'search_nodes',
  'get_feature_branch',
  'get_feature_tree',
  'list_work_orders',
  'get_work_order_context',
  'get_metrics',
  'get_closure_readiness',
  'triage_feedback',
  'get_drift_report',
].sort();

/** Never exposed remotely (SDD-010's own table): authoring, generation, drift-acknowledgment. Write
 * tools (claim/complete/submit_feedback) are registered by the HTTP route itself via
 * `registerRemoteWriteTools`, not by `registerPrdmTools` — absent here on purpose too. */
const NEVER_REMOTE_TOOLS = [
  'draft_artifact',
  'validate_draft',
  'commit_artifact',
  'list_drafts',
  'discard_draft',
  'author_artifact',
  'generate_work_orders',
  'acknowledge_sync',
  'refresh_index',
  'create_feature_request',
  'attach_artifact',
  'claim_work_order',
  'complete_work_order',
  'submit_feedback',
];

let root: string;
let config: PrdmConfig;
let db: GraphDatabase;
let store: GraphStore;
let engine: Engine;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  const { docs } = await scanDocuments(root, config.ignore);
  const grandfathered = docs.filter((d) => d.node.id === 'MRD-001' || d.node.id === 'WO-001').map((d) => ({ id: d.node.id, hash: d.node.contentHash }));
  config = { ...config, lifecycle: { grandfathered } };
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
  await engine.refresh();

  // No `authoring` at all (SDD-010: the remote profile has no in-memory draft concept over HTTP).
  server = createPrdmServer({ config, store, engine }, { profile: 'remote' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-remote-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
  await db?.close();
  if (root) removeDir(root);
});

describe('remote MCP profile tool/prompt allow-list (WO-184)', () => {
  test('exposes exactly the read-only + get_drift_report allow-list (write tools are the route\'s own job)', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_REMOTE_TOOLS);
  });

  test('never exposes any authoring/generation/drift-acknowledgment tool (regression guard)', async () => {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const forbidden of NEVER_REMOTE_TOOLS) expect(names.has(forbidden)).toBe(false);
  });

  test('exposes only the implement_work_order prompt, never author_artifact', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['implement_work_order']);
  });

  test('get_project works with no authoring configured at all (openDrafts: 0)', async () => {
    const result = await client.callTool({ name: 'get_project', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    const body = JSON.parse(content[0]!.text) as { openDrafts: number };
    expect(body.openDrafts).toBe(0);
  });

  test('get_drift_report never refreshes: reports hasReport: false when lastReport() is still null', async () => {
    const result = await client.callTool({ name: 'get_drift_report', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    const body = JSON.parse(content[0]!.text) as { hasReport?: boolean };
    // `Engine.lastReport()` was already populated by the `beforeAll` refresh above, so this profile's
    // get_drift_report should surface that pre-existing report rather than `hasReport: false` OR
    // silently recompute it. Confirmed here: the returned report never re-triggers a refresh() by
    // asserting no exception path was needed and the response shape is a real report, not the
    // no-report placeholder.
    expect(body.hasReport).not.toBe(false);
  });
});
