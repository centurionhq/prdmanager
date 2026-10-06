/**
 * `registerPrdmTools(server, deps, { profile: 'remote' })` (SDD-010's remote MCP profile, WO-184): the
 * exact allow-list from its own table, and — as a regression guard, not just a happy path — every
 * authoring/mutation-adjacent tool and prompt this profile must NEVER expose.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Engine, scanDocuments, submitFeedback, triageFeedback, type GraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { createFixtureRepo, openTestDb, removeDir, testConfig } from '@prdm/testkit';
import { createPrdmServer } from '../../src/create.js';
import type { RemoteDocumentDetail, RemoteDocumentSummary, RemoteDocumentsPort } from '../../src/documents-port.js';
import { registerRemoteAuthoringTools } from '../../src/tools-remote-authoring.js';
import { registerRemoteWriteTools } from '../../src/tools-remote.js';

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
  'close_feedback',
  'dismiss_feedback',
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

  test('get_drift_report never refreshes: returns the pre-existing lastReport() without recomputing it', async () => {
    const result = await client.callTool({ name: 'get_drift_report', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    const body = JSON.parse(content[0]!.text) as { hasReport?: boolean };
    // In this in-memory suite `Engine.lastReport()` is already populated by the `beforeAll` refresh, so
    // the remote profile must return that pre-existing report (not `hasReport: false`, which is only for
    // a project with no report) and must never recompute it. Note this suite cannot detect a
    // `PgProjectEngine.lastReport()` stub returning null: that is covered by
    // `packages/server/tests/integration/mcp-remote-drift-report.test.ts` (WO-605).
    expect(body.hasReport).not.toBe(false);
  });
});

/** In-memory `RemoteDocumentsPort` reproducing FB-095: unpublished documents live only here (never in the
 * graph) and version 1 carries `frontmatter: {}`. */
function fakeDocumentsPort(): RemoteDocumentsPort {
  const docs = new Map<string, RemoteDocumentSummary>();
  const detail = (document: RemoteDocumentSummary): RemoteDocumentDetail => ({
    document,
    latestVersion: { id: 'ver-1', versionNo: 1, contentHash: 'hash-1', renderedMarkdown: `# ${document.title}\n`, frontmatter: {} },
  });
  docs.set('ART-902', { docId: 'ART-902', kind: 'ART', title: 'Seeded draft', workflowState: 'draft', sourcePath: 'docs/art/ART-902.md' });
  return {
    async createAndSubmit(kind, title) {
      const document: RemoteDocumentSummary = { docId: `${kind}-901`, kind, title, workflowState: 'in_review', sourcePath: `docs/${kind.toLowerCase()}/${kind}-901.md` };
      docs.set(document.docId, document);
      return { document, latestVersion: { id: 'ver-1', versionNo: 1, contentHash: 'hash-1' } };
    },
    async list(filter) {
      return [...docs.values()].filter((d) => (!filter?.kind || d.kind === filter.kind) && (!filter?.workflowState || d.workflowState === filter.workflowState));
    },
    async get(docId) {
      const document = docs.get(docId);
      return document ? detail(document) : null;
    },
    async findByDocId(docId) {
      const document = docs.get(docId);
      return document ? { document, latestVersion: { id: 'ver-1', versionNo: 1, contentHash: 'hash-1' } } : null;
    },
    async saveDraftVersion() {
      throw new Error('not implemented');
    },
    async publish() {
      throw new Error('not implemented');
    },
    async getImpactsPathsDrift() {
      return null;
    },
  };
}

describe('remote MCP profile: unpublished documents via the documents port (WO-629, SDD-067, FB-095)', () => {
  let portServer: McpServer;
  let portClient: Client;

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await portClient.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    return { isError: result.isError, text };
  };

  beforeAll(async () => {
    const deps = { config, store, engine, documents: fakeDocumentsPort() };
    portServer = createPrdmServer(deps, { profile: 'remote' });
    registerRemoteAuthoringTools(portServer, deps, {
      subject: { projectRole: 'editor' },
      scopes: ['mcp:write'],
      callerHandle: 'tester',
      userId: 'user-1',
      audit: async () => {},
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    portClient = new Client({ name: 'test-remote-port-client', version: '0.0.0' });
    await Promise.all([portClient.connect(clientTransport), portServer.connect(serverTransport)]);
  });

  afterAll(async () => {
    await portClient?.close();
    await portServer?.close();
  });

  test('get_node returns a just-created in_review document with indexed: false instead of "not found"', async () => {
    const created = await call('create_document', { kind: 'ART', title: 'Customer call notes' });
    expect(created.isError).toBeFalsy();
    const { workflowState, document } = JSON.parse(created.text) as { workflowState?: string; document: { docId: string; workflowState: string } };
    expect(workflowState ?? document.workflowState).toBe('in_review');

    const result = await call('get_node', { id: document.docId });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.text) as { node: Record<string, unknown>; links: unknown[] };
    expect(body.node).toMatchObject({ id: document.docId, workflowState: 'in_review', indexed: false, label: 'Artifact', title: 'Customer call notes' });
    expect(body.node.body).toBe('# Customer call notes\n');
    expect(body.links).toEqual([]);
  });

  test('get_node also resolves a draft document', async () => {
    const result = await call('get_node', { id: 'ART-902' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text).node).toMatchObject({ id: 'ART-902', workflowState: 'draft', indexed: false });
  });

  test('get_project and prdm://project report real openDrafts and byWorkflowState', async () => {
    const project = JSON.parse((await call('get_project', {})).text) as { openDrafts: number; byWorkflowState: Record<string, number> };
    expect(project.openDrafts).toBeGreaterThanOrEqual(2);
    expect(project.byWorkflowState.in_review).toBeGreaterThanOrEqual(1);
    expect(project.byWorkflowState.draft).toBeGreaterThanOrEqual(1);

    const resource = await portClient.readResource({ uri: 'prdm://project' });
    const fromResource = JSON.parse((resource.contents[0] as { text: string }).text) as { openDrafts: number };
    expect(fromResource.openDrafts).toBe(project.openDrafts);
  });

  test('get_node of a published node still comes from the graph (no indexed flag)', async () => {
    const result = await call('get_node', { id: 'MRD-001' });
    expect(result.isError).toBeFalsy();
    const { node } = JSON.parse(result.text) as { node: Record<string, unknown> };
    expect(node.id).toBe('MRD-001');
    expect(node.indexed).toBeUndefined();
  });

  test('get_node of an id in neither the graph nor the port is still "not found"', async () => {
    const result = await call('get_node', { id: 'ART-999' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not found');
  });
});

describe('remote MCP profile: close_feedback / dismiss_feedback (WO-708)', () => {
  const auditCalls: { action: string; target: string; metadata: unknown }[] = [];
  const opened: { client: Client; server: McpServer }[] = [];

  const connect = async (subject: { projectRole: 'admin' | 'editor' | 'developer' | 'viewer' }, scopes: string[]) => {
    const srv = createPrdmServer({ config, store, engine }, { profile: 'remote' });
    registerRemoteWriteTools(srv, { config, store, engine }, {
      subject,
      scopes,
      callerHandle: 'tester',
      userId: 'user-1',
      audit: async (action, target, metadata) => {
        auditCalls.push({ action, target, metadata });
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const cli = new Client({ name: 'test-remote-write-client', version: '0.0.0' });
    await Promise.all([cli.connect(clientTransport), srv.connect(serverTransport)]);
    opened.push({ client: cli, server: srv });
    return cli;
  };

  const callOn = async (cli: Client, name: string, args: Record<string, unknown>) => {
    const result = await cli.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    return { isError: result.isError, text };
  };

  const seedTriaged = async (text: string) => {
    const { id } = await submitFeedback(engine, { text, source: 'agent:prdm-scout' });
    await triageFeedback(engine, id, { root: true });
    return id;
  };

  const frontmatterOf = async (id: string) => (await engine.scan()).docs.find((d) => d.node.id === id)!.frontmatter as Record<string, unknown>;

  let writer: Client;

  beforeAll(async () => {
    writer = await connect({ projectRole: 'editor' }, ['mcp:write']);
  });

  afterAll(async () => {
    for (const { client: c, server: s } of opened) {
      await c.close();
      await s.close();
    }
  });

  test('close_feedback closes a triaged feedback, records the closer, and audits it; a second close is rejected', async () => {
    const id = await seedTriaged('Las alertas de drift llegan tarde');

    const closed = await callOn(writer, 'close_feedback', { id, reason: 'entregado', resolved_by: ['WO-708'] });
    expect(closed.isError).toBeFalsy();
    expect(JSON.parse(closed.text)).toMatchObject({ id, status: 'closed', reason: 'entregado', resolvedBy: ['WO-708'] });

    const fm = await frontmatterOf(id);
    expect(fm).toMatchObject({ status: 'closed', close_reason: 'entregado', closed_by: 'dev:tester', resolved_by: ['WO-708'] });
    expect(fm.closed_at).toBeTruthy();
    expect(auditCalls).toContainEqual(expect.objectContaining({ action: 'mcp.close_feedback', target: id }));

    const again = await callOn(writer, 'close_feedback', { id, reason: 'otra vez' });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('only new or triaged feedback can be closed');
  });

  test('dismiss_feedback dismisses a triaged feedback and audits it', async () => {
    const id = await seedTriaged('Ruido sin accion posible');

    const dismissed = await callOn(writer, 'dismiss_feedback', { id, reason: 'duplicado' });
    expect(dismissed.isError).toBeFalsy();
    expect(JSON.parse(dismissed.text)).toMatchObject({ id, status: 'dismissed' });
    expect((await frontmatterOf(id)).status).toBe('dismissed');
    expect(auditCalls).toContainEqual(expect.objectContaining({ action: 'mcp.dismiss_feedback', target: id }));
  });

  test('without mcp:write both tools answer missing_scope', async () => {
    const reader = await connect({ projectRole: 'editor' }, ['mcp:read']);
    for (const [name, args] of [['close_feedback', { id: 'FB-001', reason: 'x' }], ['dismiss_feedback', { id: 'FB-001' }]] as const) {
      const result = await callOn(reader, name, args);
      expect(JSON.parse(result.text)).toMatchObject({ error: 'missing_scope' });
    }
  });

  test('a developer role (no edit_document) answers insufficient_role', async () => {
    const dev = await connect({ projectRole: 'developer' }, ['mcp:write']);
    for (const [name, args] of [['close_feedback', { id: 'FB-001', reason: 'x' }], ['dismiss_feedback', { id: 'FB-001' }]] as const) {
      const result = await callOn(dev, name, args);
      expect(JSON.parse(result.text)).toMatchObject({ error: 'insufficient_role' });
    }
  });
});
