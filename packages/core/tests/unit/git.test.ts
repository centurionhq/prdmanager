import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { dirtyPaths, parseRefs, readCommit, readCommits, readCommitsInRange } from '../../src/sync/git.js';
import { commitAll, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

describe('git integration', () => {
  test('returns no commits for a non-repository or an empty repository', async () => {
    root = makeTmpDir();
    expect(await readCommits(root, 10)).toEqual([]);
    expect(await dirtyPaths(root)).toEqual(new Set());
    gitInit(root);
    expect(await readCommits(root, 10)).toEqual([]);
  });

  test('reads commits newest-first with Refs trailers and touched files', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a', 'README.md': 'r' });
    const first = commitAll(root, 'chore: init');
    writeFiles(root, { 'src/a.ts': 'a2', 'src/b.ts': 'b' });
    const second = commitAll(root, 'feat: implement parser\n\nDetails here.\n\nRefs: WO-001, WO-002\nRefs: WO-002 PRD-001');

    const commits = await readCommits(root, 10);
    expect(commits.map((c) => c.sha)).toEqual([second, first]);
    expect(commits[0]).toMatchObject({ subject: 'feat: implement parser', author: 'prdm-test', refs: ['WO-001', 'WO-002'], files: ['src/a.ts', 'src/b.ts'], parents: [first] });
    expect(commits[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(commits[1]).toMatchObject({ refs: [], files: ['README.md', 'src/a.ts'], parents: [] });
    expect(await readCommits(root, 1)).toHaveLength(1);
  });

  test('lists modified, staged and untracked paths as dirty', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a', 'src/b.ts': 'b' });
    commitAll(root, 'init');
    writeFiles(root, { 'src/a.ts': 'changed', 'src/new file.ts': 'n' });
    expect(await dirtyPaths(root)).toEqual(new Set(['src/a.ts', 'src/new file.ts']));
  });

  test('strips paths outside a monorepo package root and keeps commits with no matching files', async () => {
    root = makeTmpDir();
    gitInit(root);
    const pkgRoot = join(root, 'packages', 'app');
    writeFiles(root, { 'packages/app/src/a.ts': 'a', 'other/b.ts': 'b' });
    const first = commitAll(root, 'feat: init');
    writeFiles(root, { 'other/b.ts': 'b2' });
    commitAll(root, 'chore: unrelated');
    writeFiles(root, { 'packages/app/src/a.ts': 'dirty', 'other/c.ts': 'dirty2' });

    const commits = await readCommits(pkgRoot, 10);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ subject: 'chore: unrelated', files: [] });
    expect(commits[1]).toMatchObject({ subject: 'feat: init', files: ['src/a.ts'] });

    const commit = await readCommit(pkgRoot, first);
    expect(commit?.files).toEqual(['src/a.ts']);
    expect(commit?.parents).toEqual([]);

    expect(await dirtyPaths(pkgRoot)).toEqual(new Set(['src/a.ts']));
  });

  test('handles non-ASCII paths in commits and dirty status', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'src/café.ts': 'a' });
    commitAll(root, 'feat: café');
    writeFiles(root, { 'src/café.ts': 'changed', 'src/résumé.ts': 'n' });

    const commits = await readCommits(root, 10);
    expect(commits[0]?.files).toEqual(['src/café.ts']);

    expect(await dirtyPaths(root)).toEqual(new Set(['src/café.ts', 'src/résumé.ts']));
  });

  test('parses Refs trailers with comma, semicolon and trailing punctuation', () => {
    expect(parseRefs('Refs: WO-001; WO-002.')).toEqual(['WO-001', 'WO-002']);
    expect(parseRefs('feat: x\n\nRefs: WO-003:, WO-004);\nRefs: (see WO-005)')).toEqual(['WO-003', 'WO-004', 'WO-005']);
  });

  test('readCommitsInRange (WO-198): oldest-first, bounded by the range, not by a max count off HEAD', async () => {
    root = makeTmpDir();
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a' });
    const base = commitAll(root, 'chore: init');
    writeFiles(root, { 'src/a.ts': 'a2' });
    const middle = commitAll(root, 'feat: touch a\n\nRefs: WO-001');
    writeFiles(root, { 'src/b.ts': 'b' });
    const head = commitAll(root, 'feat: add b');

    const commits = await readCommitsInRange(root, `${base}..${head}`);
    expect(commits.map((c) => c.sha)).toEqual([middle, head]);
    expect(commits[0]).toMatchObject({ subject: 'feat: touch a', refs: ['WO-001'], files: ['src/a.ts'], parents: [base] });
    expect(commits[1]).toMatchObject({ subject: 'feat: add b', files: ['src/b.ts'], parents: [middle] });
  });

  test('readCommitsInRange returns [] outside a git repository', async () => {
    root = makeTmpDir();
    expect(await readCommitsInRange(root, 'HEAD~1..HEAD')).toEqual([]);
  });
});
