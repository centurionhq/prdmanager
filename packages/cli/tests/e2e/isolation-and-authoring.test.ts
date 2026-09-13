import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseProjectFile } from '@prdm/core';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import {
  assertBuilt,
  CLI_DIST,
  connectMcp,
  git,
  gitInit,
  headSha,
  hashTree,
  NEO4J_TEST_URI,
  readTestNeo4jPassword,
  runCli,
  toolResult,
  withoutKeys,
  type McpSession,
} from './helpers.js';

/**
 * WO-021 (PRD-002 §5): dogfooding end-to-end over two isolated projects, driven entirely through real processes
 * (the built `prdm` CLI, the built `prdm-graph` MCP server over stdio, real `git` commits and hooks) against the
 * throwaway Neo4j instance at {@link NEO4J_TEST_URI}. Run alone with `npx vitest run packages/cli/tests/e2e`.
 *
 * Requires `npm run build` to have already produced packages/cli/dist and packages/mcp/dist.
 */

interface DraftView {
  draftId: string;
  revision: number;
  validation: { ok: boolean; issues: { code: string; severity: string; message: string }[] };
}

interface CommitResult {
  id: string;
}

const ENV_KEYS = ['NEO4J_URI', 'NEO4J_PASSWORD', 'NEO4J_USERNAME', 'NEO4J_DATABASE', 'PRDM_BIN', 'PRDM_ROOT'] as const;
let priorEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

let scratchDir = '';
let dirA = '';
let dirB = '';
let dirC = '';
let projectIdA = '';
let projectIdB = '';
let mcpA: McpSession | undefined;

let fbId = '';
let prdId = '';
let sddId = '';
let docsSha = '';

/** Extracts the `project list` line for `id` (there may be other, unrelated projects on the shared instance). */
function projectLine(output: string, id: string): string {
  const line = output
    .split('\n')
    .find((l) => l.startsWith(id));
  if (!line) throw new Error(`project ${id} not found in:\n${output}`);
  return line;
}

beforeAll(async () => {
  assertBuilt();

  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) priorEnv[key] = value;
  }
  process.env.NEO4J_URI = NEO4J_TEST_URI;
  process.env.NEO4J_PASSWORD = readTestNeo4jPassword();
  process.env.NEO4J_USERNAME = 'neo4j';
  process.env.NEO4J_DATABASE = 'neo4j';
  // Overrides the hooks' auto-detected `npx --no-install prdm` fallback so the commit-msg/post-commit hooks call
  // this exact build instead of trying (and failing) to resolve a "prdm" package from the npm registry.
  process.env.PRDM_BIN = `"${process.execPath}" "${CLI_DIST}"`;
  delete process.env.PRDM_ROOT;

  scratchDir = makeTmpDir('prdm-e2e-scratch-');
  dirA = makeTmpDir('prdm-e2e-a-');
  dirB = makeTmpDir('prdm-e2e-b-');
  dirC = makeTmpDir('prdm-e2e-c-');

  const migrate = runCli(scratchDir, ['db', 'migrate']);
  expect(migrate.code, `db migrate failed: ${migrate.stderr}`).toBe(0);
}, 120_000);

afterAll(async () => {
  await mcpA?.close();

  for (const id of [projectIdA, projectIdB]) {
    if (id) runCli(scratchDir, ['project', 'remove', id, '--yes']);
  }
  for (const dir of [scratchDir, dirA, dirB, dirC]) if (dir && existsSync(dir)) removeDir(dir);

  for (const key of ENV_KEYS) {
    if (priorEnv[key] === undefined) delete process.env[key];
    else process.env[key] = priorEnv[key];
  }
}, 60_000);

describe('1. bootstrap: two isolated projects', () => {
  test('prdm init scaffolds demo-a without NEO4J_PASSWORD in the environment', () => {
    gitInit(dirA);
    const init = runCli(dirA, ['init', '--name', 'demo-a'], withoutKeys(process.env, ['NEO4J_PASSWORD']));
    expect(init.code, init.stderr).toBe(0);
    expect(existsSync(join(dirA, '.prdm.yaml'))).toBe(true);
    expect(existsSync(join(dirA, 'docs', 'prd', '.gitkeep'))).toBe(true);
    expect(existsSync(join(dirA, '.git', 'hooks', 'commit-msg'))).toBe(true);
    expect(existsSync(join(dirA, '.git', 'hooks', 'post-commit'))).toBe(true);
    projectIdA = parseProjectFile(readFileSync(join(dirA, '.prdm.yaml'), 'utf8')).project.id;
    expect(projectIdA).toMatch(/^prj_/);
  });

  test('re-running init reports nothing to do and changes no file', () => {
    const before = hashTree(dirA);
    const rerun = runCli(dirA, ['init', '--name', 'demo-a']);
    expect(rerun.code, rerun.stderr).toBe(0);
    expect(rerun.stdout).toContain('nothing to do');
    expect(hashTree(dirA)).toBe(before);
  });

  test('prdm init scaffolds demo-b independently', () => {
    gitInit(dirB);
    const init = runCli(dirB, ['init', '--name', 'demo-b']);
    expect(init.code, init.stderr).toBe(0);
    projectIdB = parseProjectFile(readFileSync(join(dirB, '.prdm.yaml'), 'utf8')).project.id;
    expect(projectIdB).toMatch(/^prj_/);
    expect(projectIdB).not.toBe(projectIdA);
  });
});

describe('2. conversational authoring on A via MCP stdio', () => {
  test('connects to the real MCP server scoped to project A', async () => {
    mcpA = await connectMcp(dirA);
    const { tools } = await mcpA.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['draft_artifact', 'commit_artifact', 'generate_work_orders']));
  }, 30_000);

  test('author_artifact prompt for FB carries the Tech PM directive', async () => {
    const prompt = await mcpA!.client.getPrompt({ name: 'author_artifact', arguments: { kind: 'FB' } });
    const text = (prompt.messages[0]?.content as { text: string }).text;
    expect(text).toContain('Actúa como Tech PM');
    expect(text).toContain('demo-a');
  });

  test('drafts and commits a root FB (feedback needs no prior feature)', async () => {
    const draft = toolResult(
      await mcpA!.client.callTool({
        name: 'draft_artifact',
        arguments: { kind: 'FB', title: 'Alerta de drift', body: 'Contenido alpha-only-marker: el cliente pide alertas de drift.', fields: { root: true } },
      }),
    ).data as unknown as DraftView;
    expect(draft.validation.ok).toBe(true);

    const commit = toolResult(
      await mcpA!.client.callTool({ name: 'commit_artifact', arguments: { draft_id: draft.draftId, expected_revision: draft.revision } }),
    ).data as unknown as CommitResult;
    fbId = commit.id;
    expect(fbId).toBe('FB-001');
  });

  test('drafts and commits PRD-001 justified_by FB-001, pre-approved', async () => {
    const draft = toolResult(
      await mcpA!.client.callTool({
        name: 'draft_artifact',
        arguments: {
          kind: 'PRD',
          title: 'Graph Engine Alpha',
          body: 'Producto alpha-only-marker: motor de grafos con deteccion de desincronizacion.',
          fields: { justified_by: [fbId], status: 'approved' },
        },
      }),
    ).data as unknown as DraftView;
    expect(draft.validation.ok).toBe(true);

    const commit = toolResult(
      await mcpA!.client.callTool({ name: 'commit_artifact', arguments: { draft_id: draft.draftId, expected_revision: draft.revision } }),
    ).data as unknown as CommitResult;
    prdId = commit.id;
    expect(prdId).toBe('PRD-001');
  });

  test('an SDD draft with no "## Tareas" checklist fails lifecycle validation and cannot be committed', async () => {
    const draft = toolResult(
      await mcpA!.client.callTool({
        name: 'draft_artifact',
        arguments: {
          kind: 'SDD',
          title: 'Arquitectura Alpha',
          body: 'Diseño sin checklist todavia.',
          fields: { architects: [prdId], impacts_paths: ['src/**'] },
        },
      }),
    ).data as unknown as DraftView;
    expect(draft.validation.ok).toBe(false);
    expect(draft.validation.issues.some((i) => i.code === 'lifecycle' && i.severity === 'error' && /Tareas/.test(i.message))).toBe(true);

    const rejected = toolResult(
      await mcpA!.client.callTool({ name: 'commit_artifact', arguments: { draft_id: draft.draftId, expected_revision: draft.revision } }),
    );
    expect(rejected.isError).toBe(true);

    const fixed = toolResult(
      await mcpA!.client.callTool({
        name: 'draft_artifact',
        arguments: {
          draft_id: draft.draftId,
          expected_revision: draft.revision,
          kind: 'SDD',
          title: 'Arquitectura Alpha',
          body: '## Tareas\n- [ ] Implementar feature.ts\n- [ ] Implementar feature2.ts\n',
          fields: { architects: [prdId], impacts_paths: ['src/**'] },
        },
      }),
    ).data as unknown as DraftView;
    expect(fixed.validation.ok).toBe(true);

    const commit = toolResult(
      await mcpA!.client.callTool({ name: 'commit_artifact', arguments: { draft_id: fixed.draftId, expected_revision: fixed.revision } }),
    ).data as unknown as CommitResult;
    sddId = commit.id;
    expect(sddId).toBe('SDD-001');
  });

  test('generate_work_orders turns the checklist into two pending work orders', async () => {
    const gen = toolResult(await mcpA!.client.callTool({ name: 'generate_work_orders', arguments: { blueprint_id: sddId } })).data as unknown as {
      created: { id: string; status: string }[];
    };
    expect(gen.created.map((w) => w.id)).toEqual(['WO-001', 'WO-002']);
    expect(gen.created.every((w) => w.status === 'pending')).toBe(true);
  });

  test('the docs-only commit passes the commit-msg hook (no governed src/** touched yet)', () => {
    expect(git(dirA, ['add', 'docs', '.prdm']).code).toBe(0);
    const commit = git(dirA, ['commit', '-m', 'docs: author FB-001/PRD-001/SDD-001 via MCP; generate WO-001/WO-002']);
    expect(commit.code, commit.stderr).toBe(0);
    docsSha = headSha(dirA);
    expect(docsSha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('3. execution on A with Refs: enforcement', () => {
  test('a commit touching governed src/** without Refs is rejected by the commit-msg hook', () => {
    mkdirSync(join(dirA, 'src'), { recursive: true });
    writeFileSync(join(dirA, 'src', 'feature.ts'), 'export function feature(): number {\n  return 1;\n}\n');
    expect(git(dirA, ['add', 'src/feature.ts']).code).toBe(0);
    const commit = git(dirA, ['commit', '-m', 'feat: implement feature.ts']);
    expect(commit.code).not.toBe(0);
    expect(`${commit.stdout}${commit.stderr}`).toMatch(/Refs/);
  });

  test('a commit with Refs: WO-999 (unknown work order) is still rejected', () => {
    const commit = git(dirA, ['commit', '-m', 'feat: implement feature.ts\n\nRefs: WO-999']);
    expect(commit.code).not.toBe(0);
    expect(`${commit.stdout}${commit.stderr}`).toContain('WO-999');
  });

  test('claiming WO-001 and committing with Refs: WO-001 is accepted; complete_work_order marks it done', async () => {
    const claim = toolResult(await mcpA!.client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-001', assignee: 'agent:claude' } })).data as unknown as {
      status: string;
    };
    expect(claim.status).toBe('in_progress');

    const commit = git(dirA, ['commit', '-m', 'feat: implement feature.ts\n\nRefs: WO-001']);
    expect(commit.code, `${commit.stdout}${commit.stderr}`).toBe(0);
    const sha = headSha(dirA);

    const complete = toolResult(await mcpA!.client.callTool({ name: 'complete_work_order', arguments: { id: 'WO-001', commit_sha: sha } }))
      .data as unknown as { status: string };
    expect(complete.status).toBe('done');
  });

  test('claiming WO-002 and committing feature2.ts with Refs: WO-002 is accepted; complete_work_order marks it done', async () => {
    const claim = toolResult(await mcpA!.client.callTool({ name: 'claim_work_order', arguments: { id: 'WO-002', assignee: 'agent:claude' } })).data as unknown as {
      status: string;
    };
    expect(claim.status).toBe('in_progress');

    writeFileSync(join(dirA, 'src', 'feature2.ts'), 'export function feature2(): number {\n  return 2;\n}\n');
    expect(git(dirA, ['add', 'src/feature2.ts']).code).toBe(0);
    const commit = git(dirA, ['commit', '-m', 'feat: implement feature2.ts\n\nRefs: WO-002']);
    expect(commit.code, `${commit.stdout}${commit.stderr}`).toBe(0);
    const sha = headSha(dirA);

    const complete = toolResult(await mcpA!.client.callTool({ name: 'complete_work_order', arguments: { id: 'WO-002', commit_sha: sha } }))
      .data as unknown as { status: string };
    expect(complete.status).toBe('done');
  });

  test('prdm check commits --range passes for the whole implementation range', () => {
    const check = runCli(dirA, ['check', 'commits', '--range', `${docsSha}..HEAD`]);
    expect(check.code, `${check.stdout}${check.stderr}`).toBe(0);
    expect(check.stdout).toContain('2 commit(s) ok');
  });
});

describe('4. closure', () => {
  test('closure-readiness reports PRD-001 ready to close', () => {
    const readiness = runCli(dirA, ['closure-readiness', 'PRD-001']);
    expect(readiness.code, readiness.stderr).toBe(0);
    expect(readiness.stdout).toContain('ready to close');
  });

  test('prdm close --ack --by closes PRD-001', () => {
    const close = runCli(dirA, ['close', 'PRD-001', '--ack', '--by', 'dev:e2e']);
    expect(close.code, close.stderr).toBe(0);
    expect(close.stdout).toContain('PRD-001: closed');
  });

  test('prdm sync --check reports zero drift on the fresh, closed project', () => {
    const sync = runCli(dirA, ['sync', '--check']);
    expect(sync.code, `${sync.stdout}${sync.stderr}`).toBe(0);
    expect(sync.stdout).toContain('issues: 0');
  });
});

describe('5. isolation with project B', () => {
  test('B is populated with the SAME ids as A but distinct content, then synced', () => {
    writeFiles(dirB, {
      'docs/feedback/FB-001-beta.md': [
        '---',
        'id: FB-001',
        'type: FB',
        'title: "Feedback Beta"',
        'root: true',
        '---',
        'Contenido exclusivo beta-only-marker.',
        '',
      ].join('\n'),
      'docs/prd/PRD-001-beta.md': [
        '---',
        'id: PRD-001',
        'type: PRD',
        'title: "Graph Engine Beta"',
        'status: approved',
        'justified_by: ["FB-001"]',
        '---',
        'Producto beta-only-marker con contenido exclusivo de Beta.',
        '',
      ].join('\n'),
      'docs/sdd/SDD-001-beta.md': [
        '---',
        'id: SDD-001',
        'type: SDD',
        'title: "Beta Blueprint"',
        'architects: ["PRD-001"]',
        'impacts_paths: ["src/**"]',
        '---',
        '## Tareas',
        '- [ ] Tarea beta uno',
        '- [ ] Tarea beta dos',
        '',
      ].join('\n'),
    });
    const sync = runCli(dirB, ['sync']);
    expect(sync.code, `${sync.stdout}${sync.stderr}`).toBe(0);
  });

  test('project list shows both A and B, each correctly self-identified', () => {
    const list = runCli(dirA, ['project', 'list']);
    expect(list.code, list.stderr).toBe(0);
    expect(list.stdout).toContain(projectIdA);
    expect(list.stdout).toContain(projectIdB);
    expect(projectLine(list.stdout, projectIdA)).toContain('(this checkout)');
    expect(projectLine(list.stdout, projectIdB)).not.toContain('(this checkout)');
  });

  test('search/tree/node in A never leak B\'s titles, and vice versa', () => {
    const searchAlphaInA = runCli(dirA, ['search', 'alpha-only-marker']);
    expect(searchAlphaInA.stdout).toContain('Graph Engine Alpha');
    const searchBetaInA = runCli(dirA, ['search', 'beta-only-marker']);
    expect(searchBetaInA.stdout).not.toContain('Beta');

    const searchBetaInB = runCli(dirB, ['search', 'beta-only-marker']);
    expect(searchBetaInB.stdout).toContain('Graph Engine Beta');
    const searchAlphaInB = runCli(dirB, ['search', 'alpha-only-marker']);
    expect(searchAlphaInB.stdout).not.toContain('Alpha');

    const treeInA = runCli(dirA, ['tree']);
    expect(treeInA.stdout).toContain('Alpha');
    expect(treeInA.stdout).not.toContain('Beta');
    const treeInB = runCli(dirB, ['tree']);
    expect(treeInB.stdout).toContain('Beta');
    expect(treeInB.stdout).not.toContain('Alpha');

    const nodeInA = runCli(dirA, ['node', 'PRD-001']);
    expect(nodeInA.code, nodeInA.stderr).toBe(0);
    expect(nodeInA.stdout).toContain('Graph Engine Alpha');
    expect(nodeInA.stdout).not.toContain('Beta');

    const nodeInB = runCli(dirB, ['node', 'PRD-001']);
    expect(nodeInB.code, nodeInB.stderr).toBe(0);
    expect(nodeInB.stdout).toContain('Graph Engine Beta');
    expect(nodeInB.stdout).not.toContain('Alpha');
  });

  test('deleting a doc in B and syncing leaves A\'s node count unchanged', () => {
    const before = projectLine(runCli(dirA, ['project', 'list']).stdout, projectIdA);
    rmSync(join(dirB, 'docs', 'sdd', 'SDD-001-beta.md'));
    const sync = runCli(dirB, ['sync']);
    expect(sync.code, `${sync.stdout}${sync.stderr}`).toBe(0);
    const after = projectLine(runCli(dirA, ['project', 'list']).stdout, projectIdA);
    expect(after).toBe(before);
  });

  test('cloning A\'s .prdm.yaml into a fresh checkout C fails the fingerprint/claim guard; A stays intact', () => {
    writeFileSync(join(dirC, '.prdm.yaml'), readFileSync(join(dirA, '.prdm.yaml'), 'utf8'));
    const beforeA = projectLine(runCli(dirA, ['project', 'list']).stdout, projectIdA);

    const sync = runCli(dirC, ['sync']);
    expect(sync.code).not.toBe(0);
    expect(sync.stderr).toContain('is bound to');
    expect(sync.stderr).toContain('prdm project claim');

    const afterA = projectLine(runCli(dirA, ['project', 'list']).stdout, projectIdA);
    expect(afterA).toBe(beforeA);
  });

  test('prdm project remove drops B, leaving A (and any pre-existing projects) untouched', () => {
    const remove = runCli(dirA, ['project', 'remove', projectIdB, '--yes']);
    expect(remove.code, remove.stderr).toBe(0);
    const list = runCli(dirA, ['project', 'list']).stdout;
    expect(list).toContain(projectIdA);
    expect(list).not.toContain(projectIdB);
    projectIdB = ''; // already gone; afterAll must not try to remove it again
  });
});

describe('6. atomic rollback smoke', () => {
  // A true mid-transaction rollback (a write failing partway through Engine.transaction's journal) needs fault
  // injection inside packages/core that this black-box e2e suite cannot perform without editing src; that failure
  // mode is already covered by packages/core's own transaction/journal integration tests. What this suite can and
  // does verify end-to-end is the fail-fast half of the same guarantee: the MCP server refuses to open *any*
  // session against a schema/database it cannot reach, so no partial state is ever exposed over stdio.
  test('the MCP server refuses to start against an unreachable Neo4j URI, leaving no partial session', async () => {
    const badEnv = { ...process.env, NEO4J_URI: 'neo4j://127.0.0.1:1' };
    await expect(connectMcp(dirA, badEnv)).rejects.toBeTruthy();
  }, 30_000);
});
