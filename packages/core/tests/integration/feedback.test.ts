import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { attachArtifact, ingestArtifactFile, MAX_ARTIFACT_BYTES } from '../../src/artifacts/ingest.js';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import { createFeatureRequest, deriveFeedbackTitle, submitFeedback } from '../../src/feedback/ingest.js';
import { dismissFeedback, markDuplicate, triageFeedback, triageFeedbackBatch } from '../../src/feedback/link.js';
import type { Neo4jGraphDatabase } from '../../src/graph/database.js';
import type { GraphStore } from '../../src/graph/types.js';
import { createFixtureRepo, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';

let root: string;
let config: PrdmConfig;
let db: Neo4jGraphDatabase;
let store: GraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
  await engine.refresh();
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

describe('Feedback Ingestor (F-05)', () => {
  test('feedback related to an existing Feature auto-links it by score', async () => {
    // Shares several real terms with PRD-001 (desincronización, motor, grafos, mcp), not just one incidental word,
    // so it clears the matched-terms gate in triage.ts on top of the score/margin thresholds.
    const result = await submitFeedback(engine, {
      text: 'Necesito alertas cuando haya desincronización en el motor de grafos con soporte MCP',
      source: 'chat',
    });

    expect(result.id).toBe('FB-001');
    expect(result.reason).toBe('score');
    expect(result.linkedTo).toEqual(['PRD-001']);
    expect(result.proposal).toBeNull();

    const node = await store.getNode(result.id);
    expect(node?.node).toMatchObject({ id: 'FB-001', label: 'Feedback', status: 'new' });
    expect(node?.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'INFORMS', direction: 'out', ref: 'PRD-001' })]));
  });

  test('feedback that explicitly mentions an id links via mention, bypassing scoring', async () => {
    const result = await submitFeedback(engine, {
      text: 'Relacionado con MRD-001: necesitamos más contexto de mercado.',
      source: 'email',
      customer: 'acme',
    });

    expect(result.id).toBe('FB-002');
    expect(result.reason).toBe('mention');
    expect(result.linkedTo).toEqual(['MRD-001']);
    expect(result.proposal).toBeNull();
  });

  test('unrelated feedback is not auto-linked and returns a triage proposal', async () => {
    const result = await submitFeedback(engine, { text: 'el botón de login es azul', source: 'chat' });

    expect(result.id).toBe('FB-003');
    expect(result.reason).toBe('none');
    expect(result.linkedTo).toEqual([]);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal?.title).toBe('el botón de login es azul');

    const node = await store.getNode(result.id);
    expect(node?.links.filter((l) => l.type === 'INFORMS')).toEqual([]);
  });

  test('createFeatureRequest promotes unrelated feedback into a proposed FR under a chosen parent', async () => {
    const result = await createFeatureRequest(engine, {
      title: 'Permitir personalizar el color del botón de login',
      description: 'El cliente pidió cambiar el color del botón de login.',
      parentId: 'PRD-001',
      feedbackId: 'FB-003',
    });

    expect(result).toMatchObject({ id: 'FR-001', parentId: 'PRD-001', feedbackId: 'FB-003', justifiedBy: ['FB-003'] });

    const fr = await store.getNode('FR-001');
    expect(fr?.node).toMatchObject({ id: 'FR-001', label: 'Feature', status: 'proposed' });
    expect(fr?.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'EVOLVES_FROM', direction: 'out', ref: 'PRD-001' })]));

    const feedback = await store.getNode('FB-003');
    expect(feedback?.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'INFORMS', direction: 'out', ref: 'FR-001' })]));
  });

  test('createFeatureRequest accepts justified_by (Feedback/Artifact ids) instead of the legacy feedback_id', async () => {
    const result = await createFeatureRequest(engine, {
      title: 'Exportar métricas en CSV',
      description: 'Pedido recogido en la llamada de cliente.',
      parentId: 'PRD-001',
      justifiedBy: ['ART-001'],
    });

    expect(result).toMatchObject({ parentId: 'PRD-001', feedbackId: null, justifiedBy: ['ART-001'] });
    const fr = await store.getNode(result.id);
    expect(fr?.node).toMatchObject({ justified_by: ['ART-001'] });
  });

  test('rejects createFeatureRequest without justified_by or the legacy feedback_id', async () => {
    await expect(createFeatureRequest(engine, { title: 'x', description: 'y', parentId: 'PRD-001' })).rejects.toThrow(/justified_by/);
  });

  test('rejects createFeatureRequest when a justified_by target is not Feedback/Artifact', async () => {
    await expect(
      createFeatureRequest(engine, { title: 'x', description: 'y', parentId: 'PRD-001', justifiedBy: ['MRD-001'] }),
    ).rejects.toThrow(/must be Feedback or Artifact/);
  });

  test('rejects submitFeedback with empty text', async () => {
    await expect(submitFeedback(engine, { text: '', source: 'chat' })).rejects.toThrow();
  });

  test('rejects createFeatureRequest with a missing parent', async () => {
    await expect(
      createFeatureRequest(engine, { title: 'x', description: 'y', parentId: 'PRD-404' }),
    ).rejects.toThrow(/not found/);
  });

  test('rejects createFeatureRequest when the parent is not a Feature', async () => {
    await expect(
      createFeatureRequest(engine, { title: 'x', description: 'y', parentId: 'SDD-001' }),
    ).rejects.toThrow(/not a Feature/);
  });

  test('a single-term-only match (Spanish stemming mismatch) is not auto-linked', async () => {
    const result = await submitFeedback(engine, { text: 'agregar modo oscuro al grafo', source: 'chat' });

    expect(result.reason).toBe('none');
    expect(result.linkedTo).toEqual([]);
    expect(result.candidates).toEqual([]);
  });
});

describe('Artifact ingestion (F-01)', () => {
  test('attachArtifact links explicit Feature ids and rejects links to non-existing Features', async () => {
    const ok = await attachArtifact(engine, { title: 'Nota de reunión', content: 'Contexto sobre PRD-001.', source: 'meeting' });
    expect(ok.linkedTo).toEqual(['PRD-001']);

    await expect(attachArtifact(engine, { title: 'x', content: 'y', source: 'other', links: ['PRD-404'] })).rejects.toThrow(/not an existing Feature/);
  });

  test('attachArtifact rejects an unlinkable artifact unless root: true is set, and writes nothing on rejection', async () => {
    await expect(attachArtifact(engine, { title: 'Nota suelta', content: 'contenido sin relación con nada conocido', source: 'other' })).rejects.toThrow(
      /no Feature link found/,
    );

    const rootArtifact = await attachArtifact(engine, { title: 'Nota raíz', content: 'contenido sin relación con nada conocido', source: 'other', root: true });
    expect(rootArtifact.linkedTo).toEqual([]);
    const node = await store.getNode(rootArtifact.id);
    expect(node?.node).toMatchObject({ root: true });
    expect(node?.links.filter((l) => l.type === 'PROVIDES_CONTEXT_FOR')).toEqual([]);
  });

  test('ingestArtifactFile normalizes a .vtt transcript and links it to PRD-001 via triage', async () => {
    const filePath = join(root, 'inbox', 'call.vtt');
    writeFiles(root, {
      'inbox/call.vtt':
        'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nCliente: necesitamos detectar desincronización de blueprints y generar work orders vía MCP automáticamente.\n',
    });

    const result = await ingestArtifactFile(engine, { filePath, source: 'call' });

    expect(result.linkedTo).toEqual(['PRD-001']);
    const node = await store.getNode(result.id);
    expect(node?.node.label).toBe('Artifact');
    expect(node?.node.body).not.toContain('WEBVTT');
    expect(node?.node.body).not.toContain('-->');
  });

  test('ingestArtifactFile rejects unsupported extensions', async () => {
    writeFiles(root, { 'inbox/call.pdf': 'binary-ish content' });
    await expect(ingestArtifactFile(engine, { filePath: join(root, 'inbox', 'call.pdf'), source: 'other' })).rejects.toThrow(/unsupported artifact file extension/);
  });

  test('ingestArtifactFile rejects oversize files', async () => {
    writeFiles(root, { 'inbox/big.txt': 'a'.repeat(MAX_ARTIFACT_BYTES + 1) });
    await expect(ingestArtifactFile(engine, { filePath: join(root, 'inbox', 'big.txt'), source: 'other' })).rejects.toThrow(/exceeds/);
  });

  test('attachArtifact rejects oversize content directly', async () => {
    await expect(attachArtifact(engine, { title: 'x', content: 'a'.repeat(MAX_ARTIFACT_BYTES + 1), source: 'other' })).rejects.toThrow(/exceeds/);
  });
});

describe('triageFeedback (SDD-012, WO-330)', () => {
  test('links an unlinked feedback to a feature and marks it triaged, applied immediately (local Engine)', async () => {
    const submitted = await submitFeedback(engine, { text: 'contenido sin relación con nada conocido todavía', source: 'chat' });
    expect(submitted.linkedTo).toEqual([]);

    const result = await triageFeedback(engine, submitted.id, { informs: ['PRD-001'] });
    expect(result).toEqual({ id: submitted.id, linkedTo: ['PRD-001'], root: false, applied: 'immediate' });

    const node = await store.getNode(submitted.id);
    expect(node?.node).toMatchObject({ status: 'triaged' });
    expect(node?.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'INFORMS', direction: 'out', ref: 'PRD-001' })]));
  });

  test('rejects triaging a feedback that is already triaged', async () => {
    const submitted = await submitFeedback(engine, { text: 'otro contenido sin relación conocida aún', source: 'chat' });
    await triageFeedback(engine, submitted.id, { informs: ['PRD-001'] });
    await expect(triageFeedback(engine, submitted.id, { informs: ['PRD-001'] })).rejects.toThrow(/only new feedback can be triaged/);
  });

  test('rejects an informs target that does not exist', async () => {
    const submitted = await submitFeedback(engine, { text: 'contenido sin relación aún, otra vez', source: 'chat' });
    await expect(triageFeedback(engine, submitted.id, { informs: ['PRD-404'] })).rejects.toThrow(/not found/);
  });
});

describe('feedback title, dismiss, duplicate and batch (SDD-065)', () => {
  const fresh = async (text: string) => (await submitFeedback(engine, { text, source: 'support' })).id;
  const frontmatterOf = async (id: string) => (await engine.scan()).docs.find((d) => d.node.id === id)!.frontmatter as Record<string, unknown>;

  test('deriveFeedbackTitle strips markdown marks, truncates and skips mark-only lines', () => {
    expect(deriveFeedbackTitle('## Feedback\n\nEl botón es azul')).toBe('El botón es azul');
    expect(deriveFeedbackTitle('> **Nota**')).toBe('Nota');
    expect(deriveFeedbackTitle('a'.repeat(200))).toHaveLength(120);
    expect(deriveFeedbackTitle('###\n\n####')).toBe('');
  });

  test('submitFeedback never titles a document with the literal "## Feedback" heading', async () => {
    const id = await fresh('## Feedback\n\nCustomers keep asking for dark mode.');
    const doc = (await engine.scan()).docs.find((d) => d.node.id === id)!;
    expect(doc.node.title).toBe('Customers keep asking for dark mode.');
    expect(doc.node.body).toContain('## Feedback');
  });

  test('dismissFeedback persists status and reason, and cannot run twice', async () => {
    const id = await fresh('ruido repetido de prueba número uno');
    await dismissFeedback(engine, id, { reason: 'ruido repetido' });
    expect(await frontmatterOf(id)).toMatchObject({ status: 'dismissed', dismiss_reason: 'ruido repetido' });
    expect((await store.getNode(id))?.node).toMatchObject({ status: 'dismissed' });
    await expect(dismissFeedback(engine, id)).rejects.toThrow(/only new feedback can be dismissed/);
  });

  test('markDuplicate persists duplicate_of and rejects an unknown target', async () => {
    const a = await fresh('primer reporte de prueba sobre duplicados');
    const b = await fresh('segundo reporte de prueba sobre duplicados');
    await markDuplicate(engine, b, { duplicateOf: a });
    expect(await frontmatterOf(b)).toMatchObject({ status: 'duplicate', duplicate_of: a });
    const c = await fresh('tercer reporte de prueba sobre duplicados');
    await expect(markDuplicate(engine, c, { duplicateOf: 'FB-404' })).rejects.toThrow(/not found/);
  });

  test('triageFeedbackBatch reports per item when one feedback is already triaged', async () => {
    const [a, b, c] = [await fresh('lote de prueba alfa'), await fresh('lote de prueba beta'), await fresh('lote de prueba gamma')] as [string, string, string];
    await triageFeedback(engine, b, { root: true });
    const result = await triageFeedbackBatch(engine, { action: 'dismiss', ids: [a, b, c], reason: 'lote' });
    expect(result).toMatchObject({ action: 'dismiss', ok: 2, failed: 1 });
    expect(result.results.map((r) => [r.id, r.ok])).toEqual([[a, true], [b, false], [c, true]]);
  });
});
