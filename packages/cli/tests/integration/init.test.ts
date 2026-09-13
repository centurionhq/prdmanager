import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { parseProjectFile } from '@prdm/core';
import { gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import type { CliDeps } from '../../src/program.js';
import { runCli } from '../../src/program.js';

let root = '';
afterEach(() => root && removeDir(root));

async function run(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    process.env[key] = env[key];
  }
  delete process.env.NEO4J_PASSWORD;
  const deps: CliDeps = { root, stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) };
  try {
    const code = await runCli(['node', 'prdm', ...args], deps);
    return { code, stdout, stderr };
  } finally {
    for (const key of Object.keys(env)) process.env[key] = previous[key];
  }
}

describe('prdm init', () => {
  test('scaffolds .prdm.yaml, doc folders and hooks without NEO4J_PASSWORD', async () => {
    root = makeTmpDir();
    gitInit(root);
    const result = await run(['init', '--name', 'demo-a']);
    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.prdm.yaml'))).toBe(true);
    expect(existsSync(join(root, 'docs', 'mrd', '.gitkeep'))).toBe(true);
    expect(existsSync(join(root, '.git', 'hooks', 'post-commit'))).toBe(true);
    expect(existsSync(join(root, '.git', 'hooks', 'commit-msg'))).toBe(true);
    expect(parseProjectFile(readFileSync(join(root, '.prdm.yaml'), 'utf8')).project.name).toBe('demo-a');
  });

  test('re-running reports nothing to do, and git status stays clean', async () => {
    root = makeTmpDir();
    gitInit(root);
    await run(['init', '--name', 'demo-a']);
    const second = await run(['init', '--name', 'demo-a']);
    expect(second.code).toBe(0);
    expect(second.stdout.join('\n')).toContain('nothing to do');
  });

  test('refuses hook installation outside a git repository, with a friendly hint toward --no-hooks', async () => {
    root = makeTmpDir();
    const result = await run(['init', '--name', 'demo-a']);
    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).toContain('--no-hooks');
  });

  test('--no-hooks works fine outside a git repository', async () => {
    root = makeTmpDir();
    const result = await run(['init', '--name', 'demo-a', '--no-hooks']);
    expect(result.code).toBe(0);
  });

  test('--no-hooks skips hook installation', async () => {
    root = makeTmpDir();
    gitInit(root);
    const result = await run(['init', '--name', 'demo-a', '--no-hooks']);
    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  test('--adopt converts an existing prdm.config.json', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'prdm.config.json': JSON.stringify({ docsDir: 'documentation', ignore: [], gitMaxCommits: 100 }) });
    const result = await run(['init', '--name', 'legacy', '--adopt']);
    expect(result.code).toBe(0);
    const settings = parseProjectFile(readFileSync(join(root, '.prdm.yaml'), 'utf8'));
    expect(settings.docsDir).toBe('documentation');
    expect(existsSync(join(root, 'prdm.config.json'))).toBe(true);
  });

  test('rejects an invalid .mcp.json under --mcp', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { '.mcp.json': '{ not json' });
    const result = await run(['init', '--name', 'demo-a', '--mcp']);
    expect(result.code).not.toBe(0);
    expect(result.stderr.join('\n')).toContain('not valid JSON');
  });
});
