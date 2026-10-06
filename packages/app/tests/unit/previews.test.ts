import { describe, expect, it } from 'vitest';
import {
  branchDisplay,
  deltaTone,
  formatDelta,
  issueDelta,
  rankPreviews,
} from '../../src/routes/drift/previews.js';

const REPO = 'centurionhq/prdmanager';

describe('branchDisplay', () => {
  it('reads the GITHUB_REF_NAME of a pull_request event (32/merge) as a PR', () => {
    expect(branchDisplay('32/merge', REPO)).toEqual({
      label: 'PR #32',
      title: 'Rama del reporte: 32/merge',
      href: 'https://github.com/centurionhq/prdmanager/pull/32',
      kind: 'pull-request',
    });
  });

  it('reads refs/pull/<N>/merge as a PR', () => {
    const display = branchDisplay('refs/pull/7/merge', REPO);
    expect(display.label).toBe('PR #7');
    expect(display.href).toBe('https://github.com/centurionhq/prdmanager/pull/7');
    expect(display.kind).toBe('pull-request');
  });

  it('reads refs/pull/<N>/head as a PR', () => {
    const display = branchDisplay('refs/pull/7/head', REPO);
    expect(display.label).toBe('PR #7');
    expect(display.href).toBe('https://github.com/centurionhq/prdmanager/pull/7');
    expect(display.kind).toBe('pull-request');
  });

  it('keeps a working branch name as-is and links to its tree', () => {
    expect(branchDisplay('feat/ramas-con-slash', REPO)).toEqual({
      label: 'feat/ramas-con-slash',
      title: 'Rama del reporte: feat/ramas-con-slash',
      href: 'https://github.com/centurionhq/prdmanager/tree/feat/ramas-con-slash',
      kind: 'branch',
    });
  });

  it('escapes spaces but keeps the literal slash in the branch path', () => {
    expect(branchDisplay('feat/algo raro', REPO).href).toBe(
      'https://github.com/centurionhq/prdmanager/tree/feat/algo%20raro',
    );
  });

  it('falls back to (rama desconocida) without a link for a null branch', () => {
    expect(branchDisplay(null, REPO)).toEqual({
      label: '(rama desconocida)',
      title: 'Rama del reporte: (desconocida)',
      href: null,
      kind: 'unknown',
    });
  });

  it('never builds a link without a github_repository', () => {
    expect(branchDisplay('32/merge', null)).toEqual({
      label: 'PR #32',
      title: 'Rama del reporte: 32/merge',
      href: null,
      kind: 'pull-request',
    });
    expect(branchDisplay('feat/algo', null).href).toBeNull();
    expect(branchDisplay('feat/algo', null).kind).toBe('branch');
  });

  it('refuses to build a link from a malformed repository', () => {
    for (const repository of ['', 'sin-slash', 'owner/', '/repo', 'a b/c']) {
      expect(branchDisplay('feat/algo', repository).href).toBeNull();
      expect(branchDisplay('32/merge', repository).href).toBeNull();
    }
  });
});

describe('issueDelta', () => {
  it('is the signed difference against the official report', () => {
    expect(issueDelta(380, 226)).toBe(154);
    expect(issueDelta(142, 226)).toBe(-84);
    expect(issueDelta(226, 226)).toBe(0);
  });

  it('is null with no reference instead of inventing a 0', () => {
    expect(issueDelta(380, null)).toBeNull();
    expect(issueDelta(0, null)).toBeNull();
  });

  it('handles large counts', () => {
    expect(issueDelta(1_234_567, 1_234_000)).toBe(567);
  });
});

describe('formatDelta', () => {
  it('signs positives, keeps the negatives minus, and prints a bare 0', () => {
    expect(formatDelta(154)).toBe('+154');
    expect(formatDelta(-84)).toBe('-84');
    expect(formatDelta(0)).toBe('0');
  });

  it('does not group thousands', () => {
    expect(formatDelta(1234)).toBe('+1234');
    expect(formatDelta(-1234)).toBe('-1234');
  });
});

describe('deltaTone', () => {
  it('maps sign to tone and null to unknown', () => {
    expect(deltaTone(1)).toBe('worse');
    expect(deltaTone(154)).toBe('worse');
    expect(deltaTone(-1)).toBe('better');
    expect(deltaTone(-84)).toBe('better');
    expect(deltaTone(0)).toBe('same');
    expect(deltaTone(null)).toBe('unknown');
  });
});

describe('rankPreviews', () => {
  const preview = (branch: string | null, issueCount: number) => ({ branch, issueCount, id: branch ?? 'none' });

  it('sorts worst-first by delta against the reference', () => {
    const previews = [preview('a', 300), preview('b', 380), preview('c', 142)];
    expect(rankPreviews(previews, 226).map((p) => p.branch)).toEqual(['b', 'a', 'c']);
  });

  it('tie-breaks by issueCount then by branch ascending, null branch last', () => {
    const previews = [preview('zeta', 300), preview('alpha', 300), preview(null, 300), preview('beta', 300)];
    expect(rankPreviews(previews, 226).map((p) => p.branch)).toEqual(['alpha', 'beta', 'zeta', null]);
  });

  it('drops the worse branches to the front even with a higher raw count', () => {
    const previews = [preview('low', 1), preview('high', 999)];
    expect(rankPreviews(previews, 0).map((p) => p.branch)).toEqual(['high', 'low']);
  });

  it('keeps the server order when there is no reference', () => {
    const previews = [preview('c', 142), preview('a', 380), preview('b', 300)];
    expect(rankPreviews(previews, null).map((p) => p.branch)).toEqual(['c', 'a', 'b']);
  });

  it('never mutates the input array', () => {
    const previews = [preview('a', 300), preview('b', 380)];
    const snapshot = [...previews];
    rankPreviews(previews, 226);
    expect(previews).toEqual(snapshot);
    const unordered = [preview('c', 142), preview('a', 380)];
    const unorderedSnapshot = [...unordered];
    rankPreviews(unordered, null);
    expect(unordered).toEqual(unorderedSnapshot);
  });
});
