import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, test } from 'vitest';
import { checkLifecycle, type Engine, type GraphStore, type PrdmConfig, type ScanResult } from '@prdm/core';
import { doc } from '@prdm/testkit';
import { registerReadTools } from '../../src/tools-read.js';
import type { PrdmDeps } from '../../src/deps.js';

/**
 * SDD-125 D5: `get_node` publishes `promotion { blocking[], nextStation }`, derived from the lifecycle
 * issues `checkLifecycle` already emits (never a second implementation of the rules) and placed on the
 * line board `deriveLineBoard`/`attributeIssue` already place documents on.
 */

const BC_BODY = '## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n';
const PRD_BODY = '## Problema\n\n## Alcance\n\n## Personas y trabajos\n\n## Métrica de éxito\n\n## Features derivadas\n';
const FR_BODY = '## Alcance\n\n## Criterio de aceptación\n\n- [ ] hecho\n';

const FEEDBACK = doc('id: FB-001\ntype: FB\ntitle: Feedback\nstatus: triaged\ninforms: [BC-001]');
const BC = doc('id: BC-001\ntype: BC\ntitle: Negocio\nstatus: approved\njustified_by: [FB-001]', BC_BODY);
const PRD = doc('id: PRD-001\ntype: PRD\ntitle: Producto\nstatus: approved\njustified_by: [BC-001]', PRD_BODY);
/** Approved FR with its PRD, but no blueprint architecting it: the design hole (warning) that stops the line. */
const FR_WITHOUT_DESIGN = doc('id: FR-001\ntype: FR\ntitle: Pedido\nstatus: approved\njustified_by: [BC-001, PRD-001]', FR_BODY);
/** Approved FR justified only by its BC: R3 fails (error) *and* it has no design (warning). */
const FR_WITHOUT_PRD = doc('id: FR-002\ntype: FR\ntitle: Pedido suelto\nstatus: approved\njustified_by: [BC-001]', FR_BODY);
/** A pre-existing warning that does not stop the line and is not a Feature at all. */
const UNTRIAGED_FEEDBACK = doc('id: FB-002\ntype: FB\ntitle: Ruido\nstatus: new');

const DOCS = [FEEDBACK, BC, PRD, FR_WITHOUT_DESIGN, FR_WITHOUT_PRD, UNTRIAGED_FEEDBACK];

function nodeOf(id: string) {
  const found = DOCS.find((d) => d.node.id === id);
  return {
    node: {
      id,
      label: found?.node.label ?? 'Feature',
      kind: found?.frontmatter.type ?? 'PRD',
      title: found?.node.title ?? 't',
      status: found?.node.status ?? 'draft',
      body: found?.node.body ?? '',
      tags: [],
      source_path: found?.node.sourcePath ?? `docs/${id}.md`,
      created_at: null,
    },
    links: [],
  };
}

function deps(): PrdmDeps {
  const store = { getNode: async (id: string) => nodeOf(id) } as unknown as GraphStore;
  const engine = {
    recover: async () => undefined,
    scan: async (): Promise<ScanResult> => ({ docs: DOCS, errors: [], ids: DOCS.map((d) => d.node.id) }),
  } as unknown as Engine;
  const config = { lifecycle: { grandfathered: [] } } as unknown as PrdmConfig;
  return { store, engine, config };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content[0]?.text ?? '';
}

describe('get_node publishes promotion (SDD-125 D5)', () => {
  let client: Client | undefined;
  let server: McpServer | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    client = undefined;
    server = undefined;
  });

  async function connect(): Promise<Client> {
    server = new McpServer({ name: 'promotion-test', version: '0.0.0' });
    registerReadTools(server, deps());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'promotion-test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  async function promotionOf(id: string) {
    const c = await connect();
    const payload = JSON.parse(textOf(await c.callTool({ name: 'get_node', arguments: { id } })));
    return payload.promotion as { blocking: { code: string; message: string; station: string | null }[]; nextStation: string | null };
  }

  test('the design hole blocks an approved FR at diseno_tecnico and nextStation names it', async () => {
    const promotion = await promotionOf('FR-001');
    expect(promotion.blocking).toHaveLength(1);
    expect(promotion.blocking[0]).toMatchObject({ code: 'feature_without_blueprint', station: 'diseno_tecnico' });
    expect(promotion.blocking[0]?.message).toContain('no blueprint architecting');
    expect(promotion.nextStation).toBe('diseno_tecnico');
  });

  test('the earliest blocking station wins when a document is blocked twice', async () => {
    const promotion = await promotionOf('FR-002');
    expect(promotion.blocking.map((b) => b.code).sort()).toEqual(['feature_without_blueprint', 'lifecycle_violation']);
    expect(promotion.blocking.find((b) => b.code === 'lifecycle_violation')?.station).toBe('producto');
    expect(promotion.nextStation).toBe('producto');
  });

  test('with nothing blocking, nextStation is the station after the one the board places it on', async () => {
    const promotion = await promotionOf('BC-001');
    expect(promotion.blocking).toEqual([]);
    expect(promotion.nextStation).toBe('diseno_tecnico');
  });

  test('a warning that does not stop the line is never promoted to a blocker', async () => {
    const promotion = await promotionOf('FB-002');
    expect(promotion.blocking).toEqual([]);
    expect(promotion.nextStation).toBeNull();
  });

  test('blocking messages are the lifecycle ones, verbatim: no second implementation of the rules', async () => {
    const promotion = await promotionOf('FR-001');
    const fromLifecycle = checkLifecycle(DOCS, { grandfathered: [], mode: 'publish' })
      .filter((issue) => issue.nodeId === 'FR-001' && issue.severity === 'error')
      .map((issue) => issue.message);
    // FR-001 has no error at publish; its only issue is the design warning that stops the line.
    expect(fromLifecycle).toEqual([]);
    const warnings = checkLifecycle(DOCS, { grandfathered: [], mode: 'publish' })
      .filter((issue) => issue.nodeId === 'FR-001')
      .map((issue) => issue.message);
    expect(promotion.blocking.map((b) => b.message)).toEqual(warnings);
  });

  test('the tool description names promotion, like every other published extra field', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    const description = tools.find((t) => t.name === 'get_node')?.description ?? '';
    expect(description).toContain('promotion');
  });
});
