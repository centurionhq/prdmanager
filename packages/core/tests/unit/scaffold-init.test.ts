import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { applyInit, planInit } from '../../src/scaffold/init.js';
import { parseProjectFile } from '../../src/project/file.js';
import { commitAll, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

const RANDOM = () => Buffer.from('11'.repeat(8), 'hex');

let root = '';
afterEach(() => root && removeDir(root));

describe('planInit / applyInit', () => {
  test('a fresh directory writes .prdm.yaml, doc folders and .gitignore entries', async () => {
    root = makeTmpDir();
    const plan = await planInit(root, { name: 'demo', random: RANDOM });
    expect(plan.projectFile.project).toEqual({ id: 'prj_1111111111111111', name: 'demo' });
    const paths = plan.writes.map((w) => w.path).sort();
    expect(paths).toContain('.prdm.yaml');
    expect(paths).toContain('docs/mrd/.gitkeep');
    expect(paths).toContain('docs/work-orders/.gitkeep');
    expect(paths).toContain('.gitignore');

    await applyInit(root, plan);
    expect(parseProjectFile(readFileSync(join(root, '.prdm.yaml'), 'utf8')).project.name).toBe('demo');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.prdm/engine.lock');
  });

  test('re-running after apply produces an empty plan (idempotent)', async () => {
    root = makeTmpDir();
    await applyInit(root, await planInit(root, { name: 'demo', random: RANDOM }));
    const second = await planInit(root, { name: 'demo', random: RANDOM });
    expect(second.writes).toEqual([]);
  });

  test('re-running keeps the original project id even with a different random source', async () => {
    root = makeTmpDir();
    await applyInit(root, await planInit(root, { name: 'demo', random: RANDOM }));
    const second = await planInit(root, { name: 'demo', random: () => Buffer.from('22'.repeat(8), 'hex') });
    expect(second.projectFile.project.id).toBe('prj_1111111111111111');
  });

  test('an existing .gitkeep is never rewritten', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'docs/mrd/.gitkeep': 'not empty' });
    const plan = await planInit(root, { name: 'demo', random: RANDOM });
    expect(plan.writes.map((w) => w.path)).not.toContain('docs/mrd/.gitkeep');
  });

  test('appends missing .gitignore lines once and stops once all are present', async () => {
    root = makeTmpDir();
    writeFiles(root, { '.gitignore': 'dist/\n.prdm/engine.lock\n' });
    const plan = await planInit(root, { name: 'demo', random: RANDOM });
    await applyInit(root, plan);
    const content = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(content).toBe('dist/\n.prdm/engine.lock\n.prdm/journal-*.json\n.prdm/graph-stale\n');

    const second = await planInit(root, { name: 'demo', random: RANDOM });
    expect(second.writes.map((w) => w.path)).not.toContain('.gitignore');
  });

  test('--mcp merges prdm-graph into .mcp.json, preserving other servers', async () => {
    root = makeTmpDir();
    writeFiles(root, { '.mcp.json': JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x' } } }) });
    const plan = await planInit(root, { name: 'demo', random: RANDOM, mcp: true });
    await applyInit(root, plan);
    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.other).toEqual({ type: 'stdio', command: 'x' });
    expect(mcp.mcpServers['prdm-graph']).toMatchObject({ command: 'npx' });

    const second = await planInit(root, { name: 'demo', random: RANDOM, mcp: true });
    expect(second.writes.map((w) => w.path)).not.toContain('.mcp.json');
  });

  test('--mcp refuses an invalid .mcp.json', async () => {
    root = makeTmpDir();
    writeFiles(root, { '.mcp.json': '{ not json' });
    await expect(planInit(root, { name: 'demo', random: RANDOM, mcp: true })).rejects.toThrow(/not valid JSON/);
  });

  test('without --mcp, .mcp.json is left untouched', async () => {
    root = makeTmpDir();
    const plan = await planInit(root, { name: 'demo', random: RANDOM });
    expect(plan.writes.map((w) => w.path)).not.toContain('.mcp.json');
  });

  test('--adopt converts prdm.config.json, keeps it on disk, and records the current HEAD sha', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'prdm.config.json': JSON.stringify({ docsDir: 'documentation', ignore: ['tmp/**'], gitMaxCommits: 42 }) });
    const sha = commitAll(root, 'chore: legacy project');

    const plan = await planInit(root, { name: 'legacy', adopt: true, random: RANDOM });
    expect(plan.projectFile.docsDir).toBe('documentation');
    expect(plan.projectFile.folders.MRD).toBe('documentation/mrd');
    expect(plan.projectFile.ignore).toEqual(['tmp/**']);
    expect(plan.projectFile.git).toEqual({ maxCommits: 42, enforceRefs: true, enforceRefsSince: sha });
    expect(plan.notes.some((n) => n.includes('prdm.config.json was not deleted'))).toBe(true);

    await applyInit(root, plan);
    expect(readFileSync(join(root, 'prdm.config.json'), 'utf8')).toContain('documentation');
  });

  test('--adopt without a legacy config throws', async () => {
    root = makeTmpDir();
    await expect(planInit(root, { name: 'demo', adopt: true, random: RANDOM })).rejects.toThrow(/requires prdm\.config\.json/);
  });

  test('--adopt is ignored (with a note) once .prdm.yaml already exists', async () => {
    root = makeTmpDir();
    await applyInit(root, await planInit(root, { name: 'demo', random: RANDOM }));
    writeFiles(root, { 'prdm.config.json': JSON.stringify({}) });
    const plan = await planInit(root, { name: 'demo', adopt: true, random: RANDOM });
    expect(plan.writes).toEqual([]);
    expect(plan.notes.some((n) => n.includes('--adopt ignored'))).toBe(true);
  });

  test('an invalid existing .prdm.yaml is refused without --force and regenerated with --force', async () => {
    root = makeTmpDir();
    writeFiles(root, { '.prdm.yaml': 'not: [valid\n' });
    await expect(planInit(root, { name: 'demo', random: RANDOM })).rejects.toThrow(/invalid/);
    const forced = await planInit(root, { name: 'demo', random: RANDOM, force: true });
    expect(forced.projectFile.project.name).toBe('demo');
    expect(forced.writes.map((w) => w.path)).toContain('.prdm.yaml');
  });
});
