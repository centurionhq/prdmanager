import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { checkCommitMessage, checkCommitRange, resolveDefaultBranchRange } from '../../src/sync/commit-policy-git.js';
import { generateProjectId, renderProjectFile, type ProjectFileSettings } from '../../src/project/file.js';
import { DEFAULT_AUTHORING, DEFAULT_FOLDERS, DEFAULT_GIT, DEFAULT_LIFECYCLE } from '../../src/project/types.js';
import { commitAll, git, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

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

const WO_DOC = (id: string, status: string): string => `---
id: ${id}
type: WO
title: "Task ${id}"
status: ${status}
implements: ["SDD-001"]
---
Body.
`;

function projectFile(overrides: Partial<ProjectFileSettings> = {}): string {
  const settings: ProjectFileSettings = {
    project: { id: generateProjectId(), name: 'fixture' },
    docsDir: 'docs',
    folders: DEFAULT_FOLDERS,
    ignore: [],
    git: DEFAULT_GIT,
    triage: { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 },
    lifecycle: DEFAULT_LIFECYCLE,
    authoring: DEFAULT_AUTHORING,
    ...overrides,
  };
  return renderProjectFile(settings);
}

let root = '';
afterEach(() => root && removeDir(root));

describe('checkCommitMessage (root commit)', () => {
  test('an initial commit touching governed code without Refs is rejected, and with a valid Refs is accepted', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    git(root, 'add', '-A');

    const rejected = await checkCommitMessage(root, 'chore: init');
    expect(rejected.ok).toBe(false);
    expect(rejected.requiredFor).toContain('src/a.ts');

    const accepted = await checkCommitMessage(root, 'chore: init\n\nRefs: WO-001');
    expect(accepted.ok).toBe(true);
  });
});

describe('checkCommitMessage on an existing history', () => {
  async function setupRepo(): Promise<void> {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'docs/work-orders/WO-002.md': WO_DOC('WO-002', 'done'),
      'src/a.ts': 'export const a = 1;\n',
    });
    commitAll(root, 'chore: init\n\nRefs: WO-001');
  }

  test('a governed change without Refs is rejected', async () => {
    await setupRepo();
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'feat: change a');
    expect(result.ok).toBe(false);
  });

  test('Refs naming an unknown WO is rejected', async () => {
    await setupRepo();
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'feat: change a\n\nRefs: WO-999');
    expect(result.ok).toBe(false);
  });

  test('Refs naming a done WO is rejected', async () => {
    await setupRepo();
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'feat: change a\n\nRefs: WO-002');
    expect(result.ok).toBe(false);
  });

  test('Refs naming the pending WO is accepted', async () => {
    await setupRepo();
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'feat: change a\n\nRefs: WO-001');
    expect(result.ok).toBe(true);
  });

  test('a docs-only commit is accepted without Refs', async () => {
    await setupRepo();
    writeFiles(root, { 'README.md': '# hello\n' });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'docs: readme');
    expect(result.ok).toBe(true);
  });

  test('a project with no .prdm.yaml is always accepted', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'export const a = 1;\n' });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'chore: no project file');
    expect(result.ok).toBe(true);
  });

  test('enforce_refs: false always accepts', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile({ git: { maxCommits: 500, enforceRefs: false, enforceRefsSince: null } }),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'chore: init');
    expect(result.ok).toBe(true);
  });
});

describe('checkCommitRange', () => {
  test('agrees per-commit with checkCommitMessage and fails the range when any commit fails', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    const base = commitAll(root, 'chore: init\n\nRefs: WO-001');
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    const bad = commitAll(root, 'feat: change a without refs');

    const check = await checkCommitRange(root, `${base}..${bad}`);
    expect(check.ok).toBe(false);
    expect(check.commits).toHaveLength(1);
    expect(check.commits[0]).toMatchObject({ sha: bad, result: { ok: false } });
  });

  test('a clean range with valid Refs on every commit passes', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    const base = commitAll(root, 'chore: init\n\nRefs: WO-001');
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    const good = commitAll(root, 'feat: change a\n\nRefs: WO-001');

    const check = await checkCommitRange(root, `${base}..${good}`);
    expect(check.ok).toBe(true);
  });

  test('fails when lifecycle.grandfathered grew relative to the base', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { '.prdm.yaml': projectFile(), 'README.md': 'a\n' });
    const base = commitAll(root, 'chore: init');

    writeFiles(root, {
      '.prdm.yaml': projectFile({ lifecycle: { grandfathered: [{ id: 'MRD-001', hash: 'a'.repeat(64) }] } }),
    });
    const head = commitAll(root, 'chore: grandfather MRD-001');

    const check = await checkCommitRange(root, `${base}..${head}`);
    expect(check.ok).toBe(false);
    expect(check.grandfatheredGrowthMessage).toMatch(/grandfathered grew/);
  });

  test('nested project paths are excluded from governed matching', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile({ git: { maxCommits: 500, enforceRefs: true, enforceRefsSince: null } }),
      'docs/blueprints/SDD-001.md': SDD_DOC.replace('src/**', 'packages/**'),
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'packages/nested/.prdm.yaml': projectFile({ project: { id: generateProjectId(), name: 'nested' } }),
      'packages/nested/src/a.ts': 'export const a = 1;\n',
    });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'chore: init nested project only');
    expect(result.ok).toBe(true);
  });
});

describe('enforce_refs_since', () => {
  test('exempts a commit that does not descend from the configured sha, and enforces one that does', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { '.prdm.yaml': projectFile(), README: 'a\n' });
    const since = commitAll(root, 'chore: before enforcement');

    writeFiles(root, {
      '.prdm.yaml': projectFile({ git: { maxCommits: 500, enforceRefs: true, enforceRefsSince: since } }),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    git(root, 'add', '-A');
    const withinRange = await checkCommitMessage(root, 'feat: after enforcement, no refs');
    expect(withinRange.ok).toBe(false);

    // A branch that forked before `since` and never merged it back is not a descendant of `since`.
    git(root, 'commit', '-q', '-m', 'chore: commit within range');
    git(root, 'checkout', '-q', '-b', 'stale', since);
    writeFiles(root, { 'src/b.ts': 'export const b = 1;\n' });
    git(root, 'add', '-A');
    const outsideRange = await checkCommitMessage(root, 'feat: no project file yet on this branch');
    expect(outsideRange.ok).toBe(true);
  });
});

describe('merges', () => {
  async function setupDivergentBranches(): Promise<{ base: string; mainOnly: string; featureOnly: string }> {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'line one\n',
    });
    const base = commitAll(root, 'chore: init\n\nRefs: WO-001');
    git(root, 'checkout', '-q', '-b', 'feature');
    writeFiles(root, { 'src/a.ts': 'line one\nfeature change\n' });
    const featureOnly = commitAll(root, 'feat: feature change\n\nRefs: WO-001');
    git(root, 'checkout', '-q', 'main');
    writeFiles(root, { 'src/a.ts': 'main change\nline one\n' });
    const mainOnly = commitAll(root, 'feat: main change\n\nRefs: WO-001');
    return { base, mainOnly, featureOnly };
  }

  test('a merge with a real conflict in governed code requires Refs in the range check', async () => {
    await setupDivergentBranches();
    git(root, 'merge', '--no-ff', '-X', 'ours', '-m', 'Merge branch feature', 'feature');
    const head = git(root, 'rev-parse', 'HEAD').trim();
    const base = git(root, 'rev-parse', 'main^').trim();

    const check = await checkCommitRange(root, `${base}..${head}`);
    const mergeEntry = check.commits.find((c) => c.sha === head);
    expect(mergeEntry?.result.ok).toBe(false);
  });
});

describe('resolveDefaultBranchRange', () => {
  test('falls back to origin/main when there is no origin/HEAD symbolic ref', async () => {
    root = makeTmpDir();
    gitInit(root);
    expect(await resolveDefaultBranchRange(root, 'abc123')).toBe('origin/main..abc123');
  });

  test('uses the configured origin/HEAD branch when present', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { README: 'a\n' });
    commitAll(root, 'chore: init');
    git(root, 'remote', 'add', 'origin', root);
    git(root, 'fetch', 'origin');
    git(root, 'branch', '--track', '-f', 'trunk', 'origin/main');
    git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    expect(await resolveDefaultBranchRange(root, 'abc123')).toBe('origin/main..abc123');
  });
});
