import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { Engine, type GraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { commitAll, createFixtureRepo, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';
import type { CliContext, CliDeps } from '../../src/program.js';
import { runCli } from '../../src/program.js';

interface CliRunResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

let root: string;
let config: PrdmConfig;
let db: GraphDatabase;
let store: GraphStore;
let engine: Engine;
let priorActorEnv: string | undefined;
let unlinkedFeedbackId = '';

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
});

afterAll(async () => {
  await db?.close();
  if (root) removeDir(root);
});

beforeEach(() => {
  priorActorEnv = process.env.PRDM_ACTOR;
  delete process.env.PRDM_ACTOR;
});

afterEach(() => {
  if (priorActorEnv === undefined) delete process.env.PRDM_ACTOR;
  else process.env.PRDM_ACTOR = priorActorEnv;
});

async function run(args: string[]): Promise<CliRunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDeps = {
    root,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    openContext: async (): Promise<CliContext> => ({ config, db, store, engine, close: async () => {} }),
  };
  const code = await runCli(['node', 'prdm', ...args], deps);
  return { code, stdout, stderr };
}

describe('prdm CLI: work orders, feedback, artifacts', () => {
  test('index migrates the schema and indexes the fixture repo', async () => {
    const { code, stdout } = await run(['index']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('documents: 5');
  });

  test('wo generate creates work orders from a blueprint checklist', async () => {
    const { code, stdout } = await run(['wo', 'generate', 'SDD-001']);
    expect(code).toBe(0);
    const text = stdout.join('\n');
    expect(text).toContain('WO-002');
    expect(text).toContain('WO-003');
    expect(text).toContain('skipped: 0');
  });

  test('wo list filters by status', async () => {
    const { code, stdout } = await run(['wo', 'list', '--status', 'pending']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('WO-002');
  });

  test('wo list rejects an invalid --status', async () => {
    const { code, stderr } = await run(['wo', 'list', '--status', 'bogus']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('status must be one of');
  });

  test('wo claim without --as and without PRDM_ACTOR exits 1', async () => {
    const { code, stderr } = await run(['wo', 'claim', 'WO-003']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('actor');
  });

  test('wo claim rejects an invalid actor', async () => {
    const { code, stderr } = await run(['wo', 'claim', 'WO-003', '--as', 'not-an-actor']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('actor');
  });

  test('wo claim claims a pending work order for an actor', async () => {
    const { code, stdout } = await run(['wo', 'claim', 'WO-002', '--as', 'agent:claude']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('in_progress');
  });

  test('wo context shows the blueprint and feature lineage', async () => {
    const { code, stdout } = await run(['wo', 'context', 'WO-002']);
    expect(code).toBe(0);
    const text = stdout.join('\n');
    expect(text).toContain('SDD-001');
    expect(text).toContain('PRD-001');
  });

  test('wo context --json prints a parseable context bundle', async () => {
    const { code, stdout } = await run(['wo', 'context', 'WO-002', '--json']);
    expect(code).toBe(0);
    const context = JSON.parse(stdout.join('\n')) as { blueprints: { id: string }[] };
    expect(context.blueprints.map((b) => b.id)).toEqual(['SDD-001']);
  });

  test('wo context exits 1 for an unknown id', async () => {
    const { code, stderr } = await run(['wo', 'context', 'WO-404']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('WO-404');
  });

  test('wo complete rejects an invalid --commit sha', async () => {
    const { code, stderr } = await run(['wo', 'complete', 'WO-003', '--commit', 'not-a-sha']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('invalid commit sha');
  });

  test('wo complete --commit HEAD resolves the current commit and completes the work order', async () => {
    commitAll(root, 'feat: implement WO-002\n\nRefs: WO-002');
    const { code, stdout } = await run(['wo', 'complete', 'WO-002', '--commit', 'HEAD']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('WO-002: done');
  });

  test('feedback add links related feedback to an existing feature by score', async () => {
    const { code, stdout } = await run([
      'feedback',
      'add',
      '--text',
      'Necesito alertas cuando haya desincronización en el motor de grafos con soporte MCP',
      '--source',
      'email',
    ]);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('PRD-001');
  });

  test('feedback add prints an fr create hint when nothing was linked', async () => {
    const { code, stdout } = await run(['feedback', 'add', '--text', 'el botón de login es azul', '--source', 'email']);
    expect(code).toBe(0);
    const text = stdout.join('\n');
    expect(text).toContain('prdm fr create');
    unlinkedFeedbackId = /\b(FB-\d+)\b/.exec(text)?.[1] ?? '';
    expect(unlinkedFeedbackId).not.toBe('');
  });

  test('feedback add rejects both --text and --file at once', async () => {
    const { code, stderr } = await run(['feedback', 'add', '--text', 'x', '--file', join(root, 'PRD-001.md'), '--source', 'email']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('either --text or --file');
  });

  test('feedback add rejects when neither --text nor --file is given', async () => {
    const { code, stderr } = await run(['feedback', 'add', '--source', 'email']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('either --text or --file is required');
  });

  test('feedback add reads the text from --file and prints JSON', async () => {
    writeFiles(root, { 'inbox/feedback.txt': 'Relacionado con MRD-001: más contexto de mercado, por favor.\n' });
    const { code, stdout } = await run(['feedback', 'add', '--file', join(root, 'inbox', 'feedback.txt'), '--source', 'email', '--json']);
    expect(code).toBe(0);
    const result = JSON.parse(stdout.join('\n')) as { linkedTo: string[] };
    expect(result.linkedTo).toEqual(['MRD-001']);
  });

  test('feedback add rejects a --file that does not exist', async () => {
    const { code, stderr } = await run(['feedback', 'add', '--file', join(root, 'inbox', 'missing.txt'), '--source', 'email']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('cannot read --file');
  });

  test('feedback triage prints a human-readable summary by default', async () => {
    const { code, stdout } = await run(['feedback', 'triage', '--text', 'algo relacionado con grafos']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('reason:');
  });

  test('feedback triage --json previews candidates without persisting anything', async () => {
    const { code, stdout } = await run(['feedback', 'triage', '--text', 'algo relacionado con grafos', '--json']);
    expect(code).toBe(0);
    const result = JSON.parse(stdout.join('\n')) as { candidates: unknown[] };
    expect(Array.isArray(result.candidates)).toBe(true);
  });

  test('fr create promotes unlinked feedback into a feature request', async () => {
    expect(unlinkedFeedbackId).not.toBe('');
    const { code, stdout } = await run([
      'fr',
      'create',
      '--title',
      'Botón',
      '--parent',
      'PRD-001',
      '--from-feedback',
      unlinkedFeedbackId,
    ]);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('FR-001');
  });

  test('ingest artifact normalizes a vtt transcript and links it via triage', async () => {
    writeFiles(root, {
      'inbox/call.vtt':
        'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nCliente: necesitamos detectar desincronización de blueprints y generar work orders vía MCP automáticamente.\n',
    });
    const { code, stdout } = await run(['ingest', 'artifact', join(root, 'inbox', 'call.vtt'), '--source', 'call']);
    expect(code).toBe(0);
    const text = stdout.join('\n');
    expect(text).toContain('ART-002');
    expect(text).toContain('PRD-001');
  });

  test('ingest artifact rejects an unsupported file extension', async () => {
    writeFiles(root, { 'inbox/call.pdf': 'binary-ish content' });
    const { code, stderr } = await run(['ingest', 'artifact', join(root, 'inbox', 'call.pdf'), '--source', 'other']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('unsupported artifact file extension');
  });

  test('ingest artifact accepts explicit --link ids and prints JSON', async () => {
    writeFiles(root, { 'inbox/note.txt': 'Nota sin relación textual evidente.\n' });
    const { code, stdout } = await run([
      'ingest',
      'artifact',
      join(root, 'inbox', 'note.txt'),
      '--source',
      'doc',
      '--link',
      'PRD-001',
      '--json',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout.join('\n')) as { linkedTo: string[] };
    expect(result.linkedTo).toEqual(['PRD-001']);
  });

  test('ingest artifact rejects an invalid --source', async () => {
    writeFiles(root, { 'inbox/note2.txt': 'contenido\n' });
    const { code, stderr } = await run(['ingest', 'artifact', join(root, 'inbox', 'note2.txt'), '--source', 'bogus']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('source must be one of');
  });
});
