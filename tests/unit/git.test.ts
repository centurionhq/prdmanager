import { afterEach, describe, expect, test } from 'vitest';
import { dirtyPaths, readCommits } from '../../src/sync/git.js';
import { commitAll, gitInit, makeTmpDir, removeDir, writeFiles } from '../helpers/tmp.js';

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
    expect(commits[0]).toMatchObject({ subject: 'feat: implement parser', author: 'prdm-test', refs: ['WO-001', 'WO-002'], files: ['src/a.ts', 'src/b.ts'] });
    expect(commits[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(commits[1]).toMatchObject({ refs: [], files: ['README.md', 'src/a.ts'] });
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
});
