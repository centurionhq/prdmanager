import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import { afterEach, describe, expect, test } from 'vitest';
import { filterRelevantFiles, isRelevantPath, parseDbRelatedCount, parseStagedFiles } from '../../../../scripts/hooks/pre-commit-lib.mjs';

// WO-408 / PRD-008 §4.3 (SDD-017 §4.3): `scripts/hooks/pre-commit` itself runs a real typecheck + vitest
// run (and, when the staged changes have related `db`-project tests, a real `test:services:check` +
// vitest run against Neo4j/Postgres) -- far too expensive to exercise end to end here, the same reason
// `pre-push-hook.test.ts` (WO-409) never spawns the real `pre-push` script either. These tests instead
// cover:
//   1. the pure staged-file filtering logic in `pre-commit-lib.mjs`, against fakes;
//   2. the hook's two cheapest observable behaviors, by spawning the *real* `scripts/hooks/pre-commit`
//      file against an isolated `git init` fixture (never this repo's own index -- `GIT_DIR`/
//      `GIT_WORK_TREE` env overrides redirect every git call the script makes, regardless of its own
//      hardcoded `cwd`, so this can never interfere with another agent's concurrent commit in this tree).

const PRE_COMMIT_SCRIPT = fileURLToPath(new URL('../../../../scripts/hooks/pre-commit', import.meta.url));
const NODE = process.execPath;

describe('isRelevantPath / filterRelevantFiles', () => {
  test.each(['a.ts', 'a.tsx', 'a.js', 'a.mjs', 'a.json', 'vitest.config.ts', 'packages/core/vitest.config.ts'])(
    'treats %s as relevant',
    (path) => {
      expect(isRelevantPath(path)).toBe(true);
    },
  );

  test.each(['README.md', 'a.css', 'a.png', 'Dockerfile', 'a.mts', 'a.cjs'])('treats %s as not relevant', (path) => {
    expect(isRelevantPath(path)).toBe(false);
  });

  test('filterRelevantFiles keeps only relevant paths, preserving order', () => {
    expect(filterRelevantFiles(['README.md', 'src/a.ts', 'a.png', 'src/b.mjs'])).toEqual(['src/a.ts', 'src/b.mjs']);
  });

  test('filterRelevantFiles returns [] when nothing is relevant', () => {
    expect(filterRelevantFiles(['README.md', 'a.png'])).toEqual([]);
  });
});

describe('parseStagedFiles', () => {
  test('splits newline-separated output into a clean array', () => {
    expect(parseStagedFiles('a.ts\nb.ts\n')).toEqual(['a.ts', 'b.ts']);
  });

  test('parses an empty diff (empty string) to []', () => {
    expect(parseStagedFiles('')).toEqual([]);
  });

  test('drops blank lines', () => {
    expect(parseStagedFiles('a.ts\n\nb.ts\n')).toEqual(['a.ts', 'b.ts']);
  });
});

describe('parseDbRelatedCount', () => {
  test('parses a plain integer', () => {
    expect(parseDbRelatedCount('0\n')).toBe(0);
    expect(parseDbRelatedCount('63')).toBe(63);
  });

  test('returns null for anything that is not a bare non-negative integer', () => {
    expect(parseDbRelatedCount('')).toBeNull();
    expect(parseDbRelatedCount('not a number')).toBeNull();
    expect(parseDbRelatedCount('-1')).toBeNull();
  });
});

describe('scripts/hooks/pre-commit (real script, isolated git fixture)', () => {
  let repo: string;

  afterEach(() => {
    if (repo) removeDir(repo);
  });

  /** Spawns the real pre-commit script with git redirected at the isolated fixture repo (`repo`),
   * regardless of the script's own hardcoded ROOT/cwd -- see the top-of-file comment. */
  function runPreCommit(env: NodeJS.ProcessEnv = {}) {
    return execFileSync(NODE, [PRE_COMMIT_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, GIT_DIR: `${repo}/.git`, GIT_WORK_TREE: repo, ...env },
      // `pre-commit` exits non-zero when it decides to abort a commit -- that's an assertion target
      // here, not a thrown-away failure, so status is inspected instead of letting execFileSync throw.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function runPreCommitExpectingExit(env: NodeJS.ProcessEnv = {}): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = runPreCommit(env);
      return { status: 0, stdout, stderr: '' };
    } catch (err) {
      const e = err as { status: number | null; stdout: string; stderr: string };
      return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
    }
  }

  test('exits 0 without running typecheck/vitest when no staged file is relevant', () => {
    repo = makeTmpDir('prdm-pre-commit-hook-');
    gitInit(repo);
    writeFiles(repo, { 'README.md': '# fixture\n' });
    git(repo, 'add', 'README.md');

    const start = Date.now();
    const result = runPreCommitExpectingExit();
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe(0);
    // A real "npm run typecheck" on this repo takes well over a second; finishing near-instantly is
    // the observable signal that the hook short-circuited instead of actually invoking it.
    expect(elapsedMs).toBeLessThan(5000);
    expect(result.stdout).not.toContain('typecheck');
  });

  test('respects PRDM_SKIP_HOOKS=1 even when a relevant file is staged', () => {
    repo = makeTmpDir('prdm-pre-commit-hook-');
    gitInit(repo);
    writeFiles(repo, { 'src/a.ts': 'export const a = 1;\n' });
    git(repo, 'add', 'src/a.ts');

    const start = Date.now();
    const result = runPreCommitExpectingExit({ PRDM_SKIP_HOOKS: '1' });
    const elapsedMs = Date.now() - start;

    expect(result.status).toBe(0);
    // Unlike the "nothing relevant staged" case, a.ts staged here WOULD normally trigger a real
    // "npm run typecheck" against this actual repository if the skip were not honored -- finishing
    // near-instantly is the signal that PRDM_SKIP_HOOKS short-circuited before that ever happened.
    expect(elapsedMs).toBeLessThan(5000);
  });
});
