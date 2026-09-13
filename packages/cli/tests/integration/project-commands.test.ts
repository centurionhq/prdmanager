import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Engine, type GraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { createFixtureRepo, openTestDb, removeDir, testConfig } from '@prdm/testkit';
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

describe('prdm project', () => {
  test('project list shows this checkout after a refresh', async () => {
    const { code, stdout } = await run(['project', 'list']);
    expect(code).toBe(0);
    const text = stdout.join('\n');
    expect(text).toContain(config.project.id);
    expect(text).toContain('(this checkout)');
  });

  test('project claim reassigns the fingerprint to the current root without error', async () => {
    const { code, stdout } = await run(['project', 'claim']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain(config.project.id);
  });

  test('project remove refuses to run without --yes', async () => {
    const { code, stderr } = await run(['project', 'remove', 'prj_0000000000000000']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('--yes');
  });

  test('project remove --yes deletes an unrelated project id without touching this one', async () => {
    const otherId = 'prj_00000000000000ab';
    await db.claimProject({ id: otherId, name: 'other', root: '/tmp/other' });

    const { code } = await run(['project', 'remove', otherId, '--yes']);
    expect(code).toBe(0);

    const projects = await db.listProjects();
    expect(projects.map((p) => p.id)).not.toContain(otherId);
    expect(projects.map((p) => p.id)).toContain(config.project.id);
    expect(await store.getNode('PRD-001')).not.toBeNull();
  });
});
