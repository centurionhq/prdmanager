import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AuthoringService, DraftStore, Engine, scanDocuments, type GraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { createFixtureRepo, openTestDb, removeDir, testConfig } from '@prdm/testkit';
import { createPrdmServer } from '../../src/create.js';

const EXPECTED_AUTHORING_TOOLS = ['get_project', 'draft_artifact', 'validate_draft', 'commit_artifact', 'list_drafts', 'discard_draft', 'get_closure_readiness'];

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
let db: GraphDatabase;
let store: GraphStore;
let engine: Engine;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  // The shared fixture predates PRD-002's lifecycle rules (MRD-001 has no justified_by, WO-001 no source_task);
  // grandfather them so this suite's assertions reflect the drift of the documents authored here.
  const { docs } = await scanDocuments(root, config.ignore);
  const grandfathered = docs.filter((d) => d.node.id === 'MRD-001' || d.node.id === 'WO-001').map((d) => ({ id: d.node.id, hash: d.node.contentHash }));
  config = { ...config, lifecycle: { grandfathered } };
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
  await engine.refresh();

  const authoring = new AuthoringService({ engine, drafts: new DraftStore(config.authoring, config.root) });
  server = createPrdmServer({ config, store, engine, authoring });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client?.close();
  await server?.close();
  await db?.close();
  if (root) removeDir(root);
});

describe('prdm-graph MCP authoring surface (WO-015)', () => {
  test('tools/list exposes the 7 authoring tools, the author_artifact prompt and the new resources', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_AUTHORING_TOOLS) expect(names).toContain(expected);

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('author_artifact');

    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === 'prdm://project')).toBe(true);
    expect(resources.some((r) => r.uri === 'prdm://templates/SDD')).toBe(true);
    expect(resources.filter((r) => r.uri.startsWith('prdm://templates/'))).toHaveLength(8);

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.some((r) => r.uriTemplate === 'prdm://templates/{kind}')).toBe(true);
  });

  test('get_project reports identity, folders, lifecycle rules, counts and draftable kinds', async () => {
    const result = json(await client.callTool({ name: 'get_project', arguments: {} }));
    expect(result.id).toBe(config.project.id);
    expect(result.name).toBe(config.project.name);
    expect(result.folders.SDD).toBeDefined();
    expect(result.lifecycle.SDD).toMatch(/Tareas/);
    expect(result.counts.PRD).toBeGreaterThanOrEqual(1);
    expect(result.draftableKinds).toEqual(expect.arrayContaining(['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'FB', 'ART']));
    expect(result.draftableKinds).not.toContain('WO');
    expect(result.openDrafts).toBe(0);
  });

  test('author_artifact prompt for kind FB opens with the Tech PM directive and includes the template and project context', async () => {
    const result = await client.getPrompt({ name: 'author_artifact', arguments: { kind: 'FB' } });
    const message = result.messages[0] as { content: { type: string; text: string } };
    expect(message.content.text).toContain(`Actúa como Tech PM del proyecto ${config.project.name}`);
    expect(message.content.text).toContain('id: FB-?');
    // WO-025: the fence tag carries a per-request random suffix so untrusted content can never forge/close it.
    expect(message.content.text).toMatch(/<project_context_[0-9a-f]{8}>[\s\S]*<\/project_context_[0-9a-f]{8}>/);
    expect(message.content.text).toContain('commit_artifact');
  });

  let fbDraftId: string;
  let fbRevision: number;
  let fbId: string;

  test('draft_artifact FB with root:true validates ok and commit_artifact writes it; get_node finds it', async () => {
    const draft = json(
      await client.callTool({
        name: 'draft_artifact',
        arguments: { kind: 'FB', title: 'Se cae el login intermitentemente', body: 'Varios clientes reportaron el mismo error.', fields: { source: 'chat', root: true } },
      }),
    );
    expect(draft.validation.ok).toBe(true);
    expect(draft.targetId).toBe('FB-?');
    fbDraftId = draft.draftId;
    fbRevision = draft.revision;

    const committed = json(await client.callTool({ name: 'commit_artifact', arguments: { draft_id: fbDraftId, expected_revision: fbRevision } }));
    fbId = committed.id;
    expect(fbId).toMatch(/^FB-\d{3,9}$/);
    expect(committed.hasBlockingIssues).toBe(false);

    const node = json(await client.callTool({ name: 'get_node', arguments: { id: fbId } }));
    expect(node.node).toMatchObject({ id: fbId, label: 'Feedback' });
  });

  test('retrying commit_artifact for the same draft returns the same tombstoned result', async () => {
    const retried = json(await client.callTool({ name: 'commit_artifact', arguments: { draft_id: fbDraftId, expected_revision: fbRevision } }));
    expect(retried.id).toBe(fbId);
  });

  test('validate_draft re-runs live validation for an open draft', async () => {
    const opened = json(
      await client.callTool({ name: 'draft_artifact', arguments: { kind: 'ART', title: 'Nota de validación', body: 'contenido', fields: { root: true } } }),
    );
    const validated = json(await client.callTool({ name: 'validate_draft', arguments: { draft_id: opened.draftId } }));
    expect(validated.draftId).toBe(opened.draftId);
    expect(validated.validation.ok).toBe(true);
    await client.callTool({ name: 'discard_draft', arguments: { draft_id: opened.draftId } });
  });

  test('commit_artifact on an unknown draft id surfaces a plain error, not a stack trace', async () => {
    const result = (await client.callTool({ name: 'commit_artifact', arguments: { draft_id: 'drf_does-not-exist', expected_revision: 0 } })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not found/);
    expect(textOf(result)).not.toMatch(/\n\s*at /);
  });

  let bcId: string;

  test('draft_artifact BC justified by the committed FB, approved, commits (PRD-011/SDD-022/023): needed before any PRD can be justified', async () => {
    const draft = json(
      await client.callTool({
        name: 'draft_artifact',
        arguments: {
          kind: 'BC',
          title: 'Reducir la tasa de fallos de login',
          body: '## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
          fields: { justified_by: [fbId], status: 'approved' },
        },
      }),
    );
    expect(draft.validation.ok).toBe(true);

    const committed = json(await client.callTool({ name: 'commit_artifact', arguments: { draft_id: draft.draftId, expected_revision: draft.revision } }));
    bcId = committed.id;
    expect(bcId).toMatch(/^BC-\d{3,9}$/);
  });

  let prdDraftId: string;
  let prdRevision: number;
  let prdId: string;

  test('draft_artifact PRD with a broken justified_by shows the issue and commit_artifact rejects it without writing', async () => {
    const draft = json(
      await client.callTool({
        name: 'draft_artifact',
        arguments: { kind: 'PRD', title: 'Autenticación resiliente', body: 'Reducir la tasa de fallos de login.', fields: { justified_by: ['FB-999'] } },
      }),
    );
    expect(draft.validation.ok).toBe(false);
    expect(draft.validation.issues.some((i: { code: string }) => i.code === 'broken_link')).toBe(true);
    prdDraftId = draft.draftId;
    prdRevision = draft.revision;

    const rejected = (await client.callTool({ name: 'commit_artifact', arguments: { draft_id: prdDraftId, expected_revision: prdRevision } })) as CallToolResult;
    expect(rejected.isError).toBe(true);
    const errorBody = json(rejected);
    expect(errorBody.issues.some((i: { code: string }) => i.code === 'broken_link')).toBe(true);
    expect(textOf(rejected)).not.toMatch(/\n\s*at /);

    const searched = await client.callTool({ name: 'search_nodes', arguments: { query: 'Autenticación resiliente' } });
    expect(json(searched).results).toEqual([]);
  });

  test('fixing justified_by with the committed BC id lets the PRD draft commit (a PRD needs a BC specifically, WO-439)', async () => {
    const fixed = json(
      await client.callTool({
        name: 'draft_artifact',
        arguments: {
          kind: 'PRD',
          title: 'Autenticación resiliente',
          body: 'Reducir la tasa de fallos de login.',
          fields: { justified_by: [bcId] },
          draft_id: prdDraftId,
          expected_revision: prdRevision,
        },
      }),
    );
    expect(fixed.validation.ok).toBe(true);

    const committed = json(await client.callTool({ name: 'commit_artifact', arguments: { draft_id: prdDraftId, expected_revision: fixed.revision } }));
    prdId = committed.id;
    expect(prdId).toMatch(/^PRD-\d{3,9}$/);
  });

  let sddDraftId: string;
  let sddRevision: number;
  let sddId: string;

  test('draft_artifact SDD without a "## Tareas" checklist shows a lifecycle issue; fixing it lets it commit', async () => {
    const draft = json(
      await client.callTool({
        name: 'draft_artifact',
        arguments: { kind: 'SDD', title: 'Diseño de autenticación resiliente', body: 'Reintentos con backoff.', fields: { architects: [prdId], impacts_paths: ['src/auth/**'] } },
      }),
    );
    expect(draft.validation.issues.some((i: { code: string }) => i.code === 'lifecycle')).toBe(true);
    sddDraftId = draft.draftId;
    sddRevision = draft.revision;

    const fixed = json(
      await client.callTool({
        name: 'draft_artifact',
        arguments: {
          kind: 'SDD',
          title: 'Diseño de autenticación resiliente',
          body: 'Reintentos con backoff.\n\n## Tareas\n\n- [ ] Implementar backoff exponencial\n',
          fields: { architects: [prdId], impacts_paths: ['src/auth/**'] },
          draft_id: sddDraftId,
          expected_revision: sddRevision,
        },
      }),
    );
    expect(fixed.validation.ok).toBe(true);

    const committed = json(await client.callTool({ name: 'commit_artifact', arguments: { draft_id: sddDraftId, expected_revision: fixed.revision } }));
    sddId = committed.id;
    expect(sddId).toMatch(/^SDD-\d{3,9}$/);
  });

  test('generate_work_orders on the new SDD creates pending work orders', async () => {
    const generated = json(await client.callTool({ name: 'generate_work_orders', arguments: { blueprint_id: sddId } }));
    expect(generated.created.length).toBeGreaterThan(0);
    for (const wo of generated.created) expect(wo.status).toBe('pending');
  });

  test('get_closure_readiness reports the feature is not ready to close', async () => {
    const readiness = json(await client.callTool({ name: 'get_closure_readiness', arguments: { feature_id: prdId } }));
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true);
  });

  // WO-025: get_closure_readiness is annotated READ_ONLY; it must never write. `closureReadiness` (core,
  // lifecycle/close.ts) is being made read-only in a parallel work order that stops it calling `engine.refresh()`
  // (which currently rewrites `.prdm/baseline.json` via `saveBaseline`, see packages/core/src/sync/baseline.ts).
  // Named clearly so the lead re-verifies this once that other change lands: it may still fail until merge.
  test('get_closure_readiness does not mutate .prdm/baseline.json (pending core lifecycle/close.ts read-only fix)', async () => {
    const { BASELINE_PATH } = await import('@prdm/core');
    const before = readFileSync(`${root}/${BASELINE_PATH}`);

    await client.callTool({ name: 'get_closure_readiness', arguments: { feature_id: prdId } });

    const after = readFileSync(`${root}/${BASELINE_PATH}`);
    expect(after.equals(before)).toBe(true);
  });

  test('list_drafts and discard_draft manage open drafts', async () => {
    const opened = json(
      await client.callTool({ name: 'draft_artifact', arguments: { kind: 'ART', title: 'Nota temporal', body: 'contenido', fields: { root: true } } }),
    );
    const before = json(await client.callTool({ name: 'list_drafts', arguments: {} }));
    expect(before.drafts.some((d: { draftId: string }) => d.draftId === opened.draftId)).toBe(true);

    const discarded = json(await client.callTool({ name: 'discard_draft', arguments: { draft_id: opened.draftId } }));
    expect(discarded.discarded).toBe(true);

    const after = json(await client.callTool({ name: 'list_drafts', arguments: {} }));
    expect(after.drafts.some((d: { draftId: string }) => d.draftId === opened.draftId)).toBe(false);
  });

  test('a forbidden field is rejected by validation and by commit', async () => {
    const draft = json(
      await client.callTool({
        name: 'draft_artifact',
        arguments: { kind: 'FB', title: 'Feedback con status prohibido', body: 'contenido', fields: { root: true, status: 'done' } },
      }),
    );
    expect(draft.validation.issues.some((i: { code: string }) => i.code === 'forbidden_field')).toBe(true);

    const rejected = (await client.callTool({ name: 'commit_artifact', arguments: { draft_id: draft.draftId, expected_revision: draft.revision } })) as CallToolResult;
    expect(rejected.isError).toBe(true);
    expect(json(rejected).issues.some((i: { code: string }) => i.code === 'forbidden_field')).toBe(true);
  });

  test('an oversize body is rejected by the input schema', async () => {
    const oversized = (await client.callTool({
      name: 'draft_artifact',
      arguments: { kind: 'FB', title: 'Demasiado grande', body: 'x'.repeat(300_000), fields: { root: true } },
    })) as CallToolResult;
    expect(oversized.isError).toBe(true);
  });

  test('an unknown kind is rejected by the input schema', async () => {
    const unknownKind = (await client.callTool({
      name: 'draft_artifact',
      arguments: { kind: 'WO', title: 'No se draftean WOs', body: 'contenido' },
    })) as CallToolResult;
    expect(unknownKind.isError).toBe(true);
  });

  test('a malformed fields key is rejected by the input schema (draft_artifact)', async () => {
    const injectionKey = (await client.callTool({
      name: 'draft_artifact',
      arguments: { kind: 'FB', title: 'Clave de campo maliciosa', body: 'contenido', fields: { 'tags: []\nstatus': 'done' } },
    })) as CallToolResult;
    expect(injectionKey.isError).toBe(true);

    const trailingSpaceKey = (await client.callTool({
      name: 'draft_artifact',
      arguments: { kind: 'FB', title: 'Clave con espacio', body: 'contenido', fields: { 'status ': 'done' } },
    })) as CallToolResult;
    expect(trailingSpaceKey.isError).toBe(true);
  });

  test('resources/read returns prdm://project and prdm://templates/{kind}', async () => {
    const project = await client.readResource({ uri: 'prdm://project' });
    const projectFirst = project.contents[0] as { mimeType?: string; text?: string };
    expect(projectFirst.mimeType).toBe('application/json');
    expect(JSON.parse(projectFirst.text ?? '{}').id).toBe(config.project.id);

    const template = await client.readResource({ uri: 'prdm://templates/SDD' });
    const templateFirst = template.contents[0] as { mimeType?: string; text?: string };
    expect(templateFirst.mimeType).toBe('text/markdown');
    expect(templateFirst.text).toContain('id: SDD-?');

    const unknown = client.readResource({ uri: 'prdm://templates/WO' });
    await expect(unknown).rejects.toThrow();
  });

  test('author_artifact prompt with a parent_id includes that node title and status', async () => {
    const result = await client.getPrompt({ name: 'author_artifact', arguments: { kind: 'FR', parent_id: prdId } });
    const message = result.messages[0] as { content: { type: string; text: string } };
    expect(message.content.text).toContain(prdId);
    expect(message.content.text).toContain('Autenticación resiliente');
  });
});
