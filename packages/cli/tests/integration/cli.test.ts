import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  DEFAULT_AUTHORING,
  DEFAULT_FOLDERS,
  DEFAULT_GIT,
  DEFAULT_LIFECYCLE,
  Engine,
  scanDocuments,
  renderProjectFile,
  type GraphDatabase,
  type GraphStore,
  type PrdmConfig,
  type ProjectFileSettings,
} from '@prdm/core';
import { createFixtureRepo, gitInit, makeTmpDir, openTestDb, removeDir, testConfig, writeFiles } from '@prdm/testkit';
import type { CliContext, CliDeps } from '../../src/program.js';
import { runCli } from '../../src/program.js';

interface CliRunResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

function projectFileDefaults(): Omit<ProjectFileSettings, 'project'> {
  return {
    docsDir: 'docs',
    folders: DEFAULT_FOLDERS,
    ignore: [],
    git: DEFAULT_GIT,
    triage: { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 },
    lifecycle: DEFAULT_LIFECYCLE,
    authoring: DEFAULT_AUTHORING,
  };
}

let root: string;
let config: PrdmConfig;
let db: GraphDatabase;
let store: GraphStore;
let engine: Engine;

beforeAll(async () => {
  root = createFixtureRepo();
  config = testConfig(root);
  // WO-019: the shared fixture predates PRD-002's lifecycle rules (MRD-001 has no justified_by, WO-001 no
  // source_task); grandfather them here so this suite's `sync --check` exit-code assertions reflect the drift
  // behavior under test, not this pre-existing fixture gap (fixture.ts is shared and not owned by this WO).
  const { docs } = await scanDocuments(root, config.ignore);
  const grandfathered = docs.filter((d) => d.node.id === 'MRD-001' || d.node.id === 'WO-001').map((d) => ({ id: d.node.id, hash: d.node.contentHash }));
  config = { ...config, lifecycle: { grandfathered } };
  ({ db, store } = await openTestDb(config));
  engine = new Engine(config, store);
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

describe('prdm CLI', () => {
  test('--help prints usage through the program output', async () => {
    const { code, stdout } = await run(['--help']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('Usage:');
  });

  test('an unknown command exits non-zero and reports the error', async () => {
    const { code, stderr } = await run(['not-a-real-command']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n').length).toBeGreaterThan(0);
  });

  test('db migrate applies schema migrations', async () => {
    const { code, stdout } = await run(['db', 'migrate']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('migrations applied');
  });

  test('index refreshes the graph', async () => {
    const { code, stdout } = await run(['index']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('documents: 6');
  });

  test('db status reports connectivity, schema version and registered projects', async () => {
    const { code, stdout } = await run(['db', 'status']);
    expect(code).toBe(0);
    const text = stdout.join('\n');
    expect(text).toContain(`uri: ${config.neo4j.uri}`);
    expect(text).toMatch(/schema version: \d+ \(expected \d+\)/);
    expect(text).toContain(config.project.id);
  });

  test('db doctor reports no orphan nodes on a freshly migrated repository', async () => {
    const { code, stdout } = await run(['db', 'doctor']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('doctor: ok');
  });

  test('lint reports a clean repository', async () => {
    const { code, stdout } = await run(['lint']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('lint clean');
  });

  test('tree renders the feature branch as text', async () => {
    const { code, stdout } = await run(['tree', '--format', 'text']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toMatch(/MRD-001[\s\S]*PRD-001[\s\S]*SDD-001/);
  });

  test('tree renders mermaid starting with flowchart TD', async () => {
    const { code, stdout } = await run(['tree', '--format', 'mermaid']);
    expect(code).toBe(0);
    expect(stdout[0]).toMatch(/^flowchart TD/);
  });

  test('tree renders JSON', async () => {
    const { code, stdout } = await run(['tree', '--format', 'json']);
    expect(code).toBe(0);
    const forest = JSON.parse(stdout.join('\n')) as unknown[];
    expect(Array.isArray(forest)).toBe(true);
  });

  test('tree rejects an unknown --format value', async () => {
    const { code, stderr } = await run(['tree', '--format', 'yaml']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('format must be one of');
  });

  test('tree exits 1 for an unknown id', async () => {
    const { code, stderr } = await run(['tree', 'PRD-404']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('PRD-404');
  });

  test('search finds documents by content', async () => {
    const { code, stdout } = await run(['search', 'grafos']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('PRD-001');
  });

  test('search filters by label and returns no results when the label excludes every hit', async () => {
    const { code, stdout } = await run(['search', 'grafos', '--label', 'Blueprint', '--limit', '5']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toBe('no results');
  });

  test('search rejects an invalid --label', async () => {
    const { code, stderr } = await run(['search', 'grafos', '--label', 'Bogus']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('label must be one of');
  });

  test('search rejects an out-of-range --limit', async () => {
    const { code, stderr } = await run(['search', 'grafos', '--limit', '0']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('limit must be');
  });

  test('node prints the node detail as JSON', async () => {
    const { code, stdout } = await run(['node', 'PRD-001']);
    expect(code).toBe(0);
    const detail = JSON.parse(stdout.join('\n')) as { node: { id: string; label: string } };
    expect(detail.node).toMatchObject({ id: 'PRD-001', label: 'Feature' });
  });

  test('sync --check passes on a clean repository', async () => {
    const { code } = await run(['sync', '--check']);
    expect(code).toBe(0);
  });

  test('sync --check fails after a blueprint changes, and ack restores it', async () => {
    const sddPath = join(root, 'docs/blueprints/SDD-001.md');
    writeFiles(root, { 'docs/blueprints/SDD-001.md': readFileSync(sddPath, 'utf8').replace('compara hashes', 'compara hashes y firmas') });

    const drift = await run(['sync', '--check']);
    expect(drift.code).toBe(1);
    expect(drift.stdout.join('\n')).toContain('blueprint_changed');

    const ack = await run(['sync', 'ack', 'SDD-001']);
    expect(ack.code).toBe(0);
    const stillStale = await run(['sync', '--check']);
    expect(stillStale.code).toBe(1);
    expect(stillStale.stdout.join('\n')).toContain('WO-001');

    expect((await run(['sync', 'ack', 'WO-001'])).code).toBe(0);
    const clean = await run(['sync', '--check']);
    expect(clean.code).toBe(0);
  });

  test('sync --json prints the refresh report as JSON', async () => {
    const { code, stdout } = await run(['sync', '--json']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout.join('\n')) as { hasBlockingIssues: boolean };
    expect(report.hasBlockingIssues).toBe(false);
  });

  test('metrics --json prints parseable metrics', async () => {
    const { code, stdout } = await run(['metrics', '--json']);
    expect(code).toBe(0);
    const metrics = JSON.parse(stdout.join('\n')) as { systemIntegrity: unknown };
    expect(metrics.systemIntegrity).toBeDefined();
  });

  test('metrics prints a human-readable summary', async () => {
    const { code, stdout } = await run(['metrics']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('System Integrity:');
  });

  test('watch rejects a negative --debounce', async () => {
    const { code, stderr } = await run(['watch', '--debounce', '-5']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('--debounce');
  });

  test('watch refreshes on changes and stops on SIGINT', async () => {
    const promise = run(['watch', '--debounce', '10']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.emit('SIGINT');
    const { code } = await promise;
    expect(code).toBe(0);
  });

  test('hooks install refuses without a .prdm.yaml', async () => {
    const noProjectRoot = makeTmpDir('prdm-no-project-');
    gitInit(noProjectRoot);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const deps: CliDeps = { root: noProjectRoot, stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) };
    const code = await runCli(['node', 'prdm', 'hooks', 'install'], deps);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('.prdm.yaml');
    removeDir(noProjectRoot);
  });

  test('hooks install writes executable post-commit and commit-msg hooks, idempotently, and refuses an unrecognized shebang without --force', async () => {
    writeFiles(root, { '.prdm.yaml': renderProjectFile({ ...projectFileDefaults(), project: config.project }) });

    const first = await run(['hooks', 'install']);
    expect(first.code).toBe(0);
    const postCommitPath = join(root, '.git', 'hooks', 'post-commit');
    const commitMsgPath = join(root, '.git', 'hooks', 'commit-msg');
    expect(existsSync(postCommitPath)).toBe(true);
    expect(existsSync(commitMsgPath)).toBe(true);
    expect(statSync(postCommitPath).mode & 0o777).toBe(0o755);
    expect(readFileSync(postCommitPath, 'utf8')).toContain(`# >>> prdm ${config.project.id} >>>`);

    const second = await run(['hooks', 'install']);
    expect(second.code).toBe(0);
    expect(second.stdout.join('\n')).toContain('unchanged');

    writeFiles(root, { '.git/hooks/commit-msg': '#!/usr/bin/env python3\nprint("custom")\n' });
    const refused = await run(['hooks', 'install']);
    expect(refused.code).toBe(1);
    expect(refused.stderr.join('\n')).toContain('unrecognized shebang');

    const forced = await run(['hooks', 'install', '--force']);
    expect(forced.code).toBe(0);
  });

  test('hooks install refuses outside a git repository', async () => {
    const nonGitRoot = makeTmpDir('prdm-no-git-');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const deps: CliDeps = { root: nonGitRoot, stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) };
    const code = await runCli(['node', 'prdm', 'hooks', 'install'], deps);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('git repository');
    removeDir(nonGitRoot);
  });

  test('db reset refuses to run without --yes', async () => {
    const { code, stderr } = await run(['db', 'reset']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('--yes');
  });

  test('db reset --yes clears and rebuilds the graph', async () => {
    const { code, stdout } = await run(['db', 'reset', '--yes']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('documents: 6');
    expect(await store.getNode('PRD-001')).not.toBeNull();
  });
});
