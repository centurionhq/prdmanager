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

describe('WO-024 finding 1a: docs deleted-then-restored inside the range cannot hide a governed change', () => {
  test('a governed change in the middle commit is still enforced even though the blueprint is absent from its own tree', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    const base = commitAll(root, 'chore: init\n\nRefs: WO-001');

    // A: delete the blueprint.
    git(root, 'rm', '-q', 'docs/blueprints/SDD-001.md');
    const commitA = commitAll(root, 'chore: remove blueprint temporarily');

    // B: change governed code, no Refs, and (at this point in history) no blueprint governs it.
    writeFiles(root, { 'src/a.ts': 'export const a = 2;\n' });
    const commitB = commitAll(root, 'feat: sneaky change while blueprint is gone');

    // C: restore the blueprint.
    writeFiles(root, { 'docs/blueprints/SDD-001.md': SDD_DOC });
    const head = commitAll(root, 'chore: restore blueprint');

    const check = await checkCommitRange(root, `${base}..${head}`);
    const entryB = check.commits.find((c) => c.sha === commitB);
    expect(entryB?.result.ok).toBe(false);
    expect(check.ok).toBe(false);
    expect(commitA).toBeTruthy();
  });
});

describe('WO-024 finding 1b: nested project roots are fixed at the base tree', () => {
  test('adding a nested .prdm.yaml inside the PR does not exempt code that was governed at the base', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    const base = commitAll(root, 'chore: init\n\nRefs: WO-001');

    // The PR both introduces a nested project at src/ AND changes governed code under it, without Refs.
    writeFiles(root, {
      'src/.prdm.yaml': projectFile({ project: { id: generateProjectId(), name: 'nested' } }),
      'src/a.ts': 'export const a = 2;\n',
    });
    const head = commitAll(root, 'feat: sneak in a nested project to dodge the policy');

    const check = await checkCommitRange(root, `${base}..${head}`);
    expect(check.ok).toBe(false);
  });
});

describe('WO-024 finding 1c: non-ASCII blueprint filenames are visible', () => {
  test('a blueprint whose path contains non-ASCII characters is still read and enforced', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-diseño.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    git(root, 'add', '-A');
    const result = await checkCommitMessage(root, 'chore: init, no refs');
    expect(result.ok).toBe(false);
    expect(result.requiredFor).toContain('src/a.ts');
  });
});

describe('WO-024 finding 1d: orphan root commits and silent aggregate drift are rejected', () => {
  test('an orphan root commit inside the range (not the range base) fails the check', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { '.prdm.yaml': projectFile(), 'README.md': 'a\n' });
    const base = commitAll(root, 'chore: init');

    // An unrelated history graft: a second root commit reachable from HEAD but disconnected from `base`.
    git(root, 'checkout', '-q', '--orphan', 'grafted');
    git(root, 'rm', '-q', '-rf', '--cached', '.');
    writeFiles(root, { 'grafted.txt': 'x\n' });
    const orphanSha = commitAll(root, 'chore: orphan commit');
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '-q', '--allow-unrelated-histories', '-m', 'Merge orphan branch', 'grafted');
    const head = git(root, 'rev-parse', 'HEAD').trim();

    const check = await checkCommitRange(root, `${base}..${head}`);
    expect(check.ok).toBe(false);
    expect(check.orphanCommitsMessage).toContain(orphanSha);
  });

  test('a merge that resurrects stale pre-base content is exempt per-commit but caught by the aggregate check', async () => {
    root = makeTmpDir();
    gitInit(root);
    // `stale` predates `base` in the very same branch: its governed content was already superseded before
    // enforcement even started reading history, so no commit in `base..head` will ever carry it in its own diff.
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'line one\nSTALE\n',
    });
    const stale = commitAll(root, 'chore: stale, pre-base content');
    writeFiles(root, { 'src/a.ts': 'line one\n' });
    const base = commitAll(root, 'chore: supersede the stale content\n\nRefs: WO-001');

    // A handcrafted merge whose tree exactly matches `stale`: relative to its first parent (`base`) the governed
    // path changed, but relative to its second parent (`stale`) it did not, so the pairwise conflict heuristic
    // (which only ever inspects parents 1 and 2) sees no overlap and treats the merge as a clean, exempt one -
    // while the file has, in truth, been silently reverted to un-reviewed content with no covering "Refs:" at all.
    const staleTree = git(root, 'rev-parse', `${stale}^{tree}`).trim();
    const evilMerge = git(root, 'commit-tree', staleTree, '-p', base, '-p', stale, '-m', 'Merge branch stale (evil)').trim();

    const check = await checkCommitRange(root, `${base}..${evilMerge}`);
    const mergeEntry = check.commits.find((c) => c.sha === evilMerge);
    expect(mergeEntry?.result.ok).toBe(true); // per-commit alone is fooled
    expect(check.ok).toBe(false); // the aggregate check is not
    expect(check.uncoveredPathsMessage).toContain('src/a.ts');
  });
});

describe('WO-024 finding 1e: settingsAtRef never falls back to the working tree', () => {
  test('when the base ref has no .prdm.yaml, a permissive working-tree copy is not consulted', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'README.md': 'a\n' });
    const base = commitAll(root, 'chore: init, no project file yet');

    // The working tree (as CI would leave it checked out at the PR head) carries a permissive project file that
    // must never be used to evaluate the base's settings.
    writeFiles(root, {
      '.prdm.yaml': projectFile({ git: { maxCommits: 500, enforceRefs: false, enforceRefsSince: null } }),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    const head = commitAll(root, 'feat: add project file and governed code, no refs');

    const check = await checkCommitRange(root, `${base}..${head}`);
    // Defaults (schema default enforce_refs: true) apply, not the permissive working-tree copy.
    const entry = check.commits.find((c) => c.sha === head);
    expect(entry?.result.ok).toBe(false);
  });
});

describe('WO-024 finding 2: the prdm project root can be a subdirectory of the git repository', () => {
  test('governed-path enforcement works when .prdm.yaml lives at <repo>/proj', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'outside.txt': 'not part of the project\n' });
    const projectRoot = join(root, 'proj');
    writeFiles(projectRoot, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    git(root, 'add', '-A');
    const rejected = await checkCommitMessage(projectRoot, 'chore: init');
    expect(rejected.ok).toBe(false);
    expect(rejected.requiredFor).toEqual(['src/a.ts']);

    const accepted = await checkCommitMessage(projectRoot, 'chore: init\n\nRefs: WO-001');
    expect(accepted.ok).toBe(true);

    git(root, 'commit', '-q', '-m', 'chore: init\n\nRefs: WO-001');
    const base = git(root, 'rev-parse', 'HEAD').trim();

    writeFiles(projectRoot, { 'src/a.ts': 'export const a = 2;\n' });
    const bad = commitAll(root, 'feat: change a without refs');
    const check = await checkCommitRange(projectRoot, `${base}..${bad}`);
    expect(check.ok).toBe(false);
    expect(check.commits[0]).toMatchObject({ sha: bad, result: { ok: false, requiredFor: ['src/a.ts'] } });
  });
});

describe('WO-024 finding 3: check commits --range fails loudly on git errors', () => {
  test('an unreachable/unknown sha in the range throws instead of silently passing', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { '.prdm.yaml': projectFile(), 'README.md': 'a\n' });
    const base = commitAll(root, 'chore: init');
    const bogus = '0'.repeat(40);
    await expect(checkCommitRange(root, `${base}..${bogus}`)).rejects.toThrow();
  });

  test('an empty range (no commits) still succeeds', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { '.prdm.yaml': projectFile(), 'README.md': 'a\n' });
    const base = commitAll(root, 'chore: init');
    const check = await checkCommitRange(root, `${base}..${base}`);
    expect(check.ok).toBe(true);
    expect(check.commits).toEqual([]);
  });
});

describe('WO-024 finding 5: grandfathered growth check compares (id, hash) pairs, not just count', () => {
  test('swapping the hash of an already-grandfathered id fails, even though the count is unchanged', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile({ lifecycle: { grandfathered: [{ id: 'MRD-001', hash: 'a'.repeat(64) }] } }),
      'README.md': 'a\n',
    });
    const base = commitAll(root, 'chore: init');

    writeFiles(root, {
      '.prdm.yaml': projectFile({ lifecycle: { grandfathered: [{ id: 'MRD-001', hash: 'b'.repeat(64) }] } }),
    });
    const head = commitAll(root, 'chore: swap grandfathered hash');

    const check = await checkCommitRange(root, `${base}..${head}`);
    expect(check.ok).toBe(false);
    expect(check.grandfatheredGrowthMessage).toMatch(/grandfathered grew/);
  });

  test('removing a grandfathered entry is fine', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile({ lifecycle: { grandfathered: [{ id: 'MRD-001', hash: 'a'.repeat(64) }] } }),
      'README.md': 'a\n',
    });
    const base = commitAll(root, 'chore: init');

    writeFiles(root, { '.prdm.yaml': projectFile({ lifecycle: { grandfathered: [] } }) });
    const head = commitAll(root, 'chore: un-grandfather MRD-001');

    const check = await checkCommitRange(root, `${base}..${head}`);
    expect(check.ok).toBe(true);
  });
});

describe('WO-024 finding 6 (amend): amending a root commit is evaluated against the empty tree', () => {
  test('an amend of the very first commit diffs against nothing rather than a nonexistent HEAD^', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, {
      '.prdm.yaml': projectFile(),
      'docs/blueprints/SDD-001.md': SDD_DOC,
      'docs/work-orders/WO-001.md': WO_DOC('WO-001', 'pending'),
      'src/a.ts': 'export const a = 1;\n',
    });
    commitAll(root, 'chore: init\n\nRefs: WO-001');

    // Amend the root commit: stage an additional governed file on top of the existing tree.
    writeFiles(root, { 'src/b.ts': 'export const b = 1;\n' });
    git(root, 'add', '-A');
    const rejected = await checkCommitMessage(root, 'chore: init, amended', { amend: true });
    expect(rejected.ok).toBe(false);
    expect(rejected.requiredFor).toContain('src/b.ts');

    const accepted = await checkCommitMessage(root, 'chore: init, amended\n\nRefs: WO-001', { amend: true });
    expect(accepted.ok).toBe(true);
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
