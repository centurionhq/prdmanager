import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { attachArtifact, ingestArtifactFile, MAX_ARTIFACT_BYTES } from '../../src/artifacts/ingest.js';
import type { PrdmConfig } from '../../src/config.js';
import { Engine } from '../../src/engine.js';
import { createFeatureRequest, submitFeedback } from '../../src/feedback/ingest.js';
import type { Neo4jGraphStore } from '../../src/graph/store.js';
import { createFixtureRepo, openTestStore, removeDir, testConfig, writeFiles } from '@prdm/testkit';

let root: string;
let config: PrdmConfig;
let store: Neo4jGraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  store = await openTestStore(config);
  engine = new Engine(config, store);
  await engine.refresh();
});

afterAll(async () => {
  await store?.close();
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

    expect(result).toMatchObject({ id: 'FR-001', parentId: 'PRD-001', feedbackId: 'FB-003' });

    const fr = await store.getNode('FR-001');
    expect(fr?.node).toMatchObject({ id: 'FR-001', label: 'Feature', status: 'proposed' });
    expect(fr?.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'EVOLVES_FROM', direction: 'out', ref: 'PRD-001' })]));

    const feedback = await store.getNode('FB-003');
    expect(feedback?.links).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'INFORMS', direction: 'out', ref: 'FR-001' })]));
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
