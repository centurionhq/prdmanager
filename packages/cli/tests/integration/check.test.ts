import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

describe('prdm check commit-msg', () => {
  test('rejects a governed change without a Refs trailer, and accepts one with a valid Refs', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC,
      'src/a.ts': 'export const a = 1;\n',
    });
    git(root, 'add', '-A');

    const msgPath = join(root, 'MSG');
    writeFileSync(msgPath, 'chore: init\n');
    const rejected = await run(['check', 'commit-msg', msgPath]);
    expect(rejected.code).toBe(1);
    expect(rejected.stderr.join('\n')).toContain('src/a.ts');

    writeFileSync(msgPath, 'chore: init\n\nRefs: WO-001\n');
    const accepted = await run(['check', 'commit-msg', msgPath]);
    expect(accepted.code).toBe(0);
  });

  test('strips # comment lines before checking', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { '.prdm.yaml': projectFile(), 'README.md': 'hello\n' });
    git(root, 'add', '-A');
    const msgPath = join(root, 'MSG');
    writeFileSync(msgPath, '# Please enter the commit message\ndocs: readme\n# Changes to be committed:\n#\tREADME.md\n');
    const result = await run(['check', 'commit-msg', msgPath]);
    expect(result.code).toBe(0);
  });
});

describe('prdm check commits --range', () => {
  test('agrees with the commit-msg policy across a real range', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC,
      'src/a.ts': 'export const a = 1;\n',
    });
    const base = commitAll(root, 'chore: init\n\nRefs: WO-001');
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    const bad = commitAll(root, 'feat: change a without refs');

    const result = await run(['check', 'commits', '--range', `${base}..${bad}`]);
    expect(result.code).toBe(1);
    expect(result.stdout.join('\n')).toContain(bad);
  });
});

const MONOREPO_ROOT = resolve(import.meta.dirname, '../../../..');
const PRDM_BIN = `node ${join(MONOREPO_ROOT, 'node_modules', '.bin', 'tsx')} --conditions=@prdm/source ${join(MONOREPO_ROOT, 'packages', 'cli', 'src', 'index.ts')}`;

describe('the installed commit-msg hook end to end', () => {
  test('rejects a real git commit missing Refs, and accepts it once added', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC,
    });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'chore: init docs');

    const installed = await run(['hooks', 'install']);
    expect(installed.code).toBe(0);

    writeFiles(root, { 'src/a.ts': 'export const a = 1;\n' });
    git(root, 'add', '-A');

    const previous = process.env.PRDM_BIN;
    process.env.PRDM_BIN = PRDM_BIN;
    try {
      expect(() => git(root, 'commit', '-q', '-m', 'feat: add a')).toThrow();
      expect(() => git(root, 'commit', '-q', '-m', 'feat: add a\n\nRefs: WO-001')).not.toThrow();
    } finally {
      process.env.PRDM_BIN = previous;
    }
  });
});
