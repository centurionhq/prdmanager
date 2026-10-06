import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_AUTHORING, DEFAULT_FOLDERS, DEFAULT_GIT, DEFAULT_LIFECYCLE, generateProjectId, renderProjectFile } from '@prdm/core';
import { commitAll, git, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import type { CliDeps } from '../../src/program.js';
import { runCli } from '../../src/program.js';

const SDD_DOC = `---
id: SDD-001
type: SDD
title: "Design"
status: active
architects: ["PRD-001"]
impacts_paths: ["src/**"]
---
Body.

## Tareas
- [ ] task
`;

const WO_DOC = `---
id: WO-001
type: WO
title: "Task"
status: pending
implements: ["SDD-001"]
---
Body.
`;

function projectFile(): string {
  return renderProjectFile({
    project: { id: generateProjectId(), name: 'fixture' },
    docsDir: 'docs',
    folders: DEFAULT_FOLDERS,
    ignore: [],
    git: DEFAULT_GIT,
    triage: { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 },
    lifecycle: DEFAULT_LIFECYCLE,
    authoring: DEFAULT_AUTHORING,
  });
}

let root = '';
afterEach(() => root && removeDir(root));

async function run(args: string[]): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDeps = { root, stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) };
  const code = await runCli(['node', 'prdm', ...args], deps);
  return { code, stdout, stderr };
}

/** Builds a repo on `branch` with a base commit and one governed commit referencing WO-001; returns the range. */
function setup(branch: string): { range: string; sha: string } {
  root = makeTmpDir();
  gitInit(root);
  writeFiles(root, {
    '.prdm.yaml': projectFile(),
    'docs/blueprints/SDD-001.md': SDD_DOC,
    'docs/work-orders/WO-001.md': WO_DOC,
    'src/a.ts': 'export const a = 1;\n',
  });
  const base = commitAll(root, 'chore: init\n\nRefs: WO-001');
  git(root, 'checkout', '-b', branch);
  writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
  const sha = commitAll(root, 'feat: change a\n\nRefs: WO-001');
  return { range: `${base}..${sha}`, sha };
}

describe('prdm check commits branch/WO alignment', () => {
  test('is silent when the branch WO matches the commit Refs', async () => {
    const { range } = setup('feat/wo-001-x');
    const result = await run(['check', 'commits', '--range', range]);
    expect(result.code).toBe(0);
    expect(result.stderr.join('\n')).not.toContain('warning:');
  });

  test('warns but exits 0 when the commit references a different WO than the branch', async () => {
    const { range, sha } = setup('feat/wo-099-x');
    const result = await run(['check', 'commits', '--range', range]);
    const stderr = result.stderr.join('\n');
    expect(result.code).toBe(0);
    expect(stderr).toContain('warning:');
    expect(stderr).toContain(sha);
    expect(stderr).toContain('WO-099');
    expect(stderr).toContain('WO-001');
  });

  test('fails with --strict when the commit is misaligned', async () => {
    const { range } = setup('feat/wo-099-x');
    const result = await run(['check', 'commits', '--range', range, '--strict']);
    expect(result.code).not.toBe(0);
  });

  test('does not check branches that declare an SDD', async () => {
    const { range } = setup('feat/sdd-002-x');
    const result = await run(['check', 'commits', '--range', range, '--strict']);
    expect(result.code).toBe(0);
    expect(result.stderr.join('\n')).not.toContain('warning:');
  });
});
