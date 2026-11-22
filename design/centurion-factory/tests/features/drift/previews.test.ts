import { describe, expect, it } from 'vitest';
import {
  branchLabel,
  deltaLine,
  deltaTone,
  formatDelta,
  issueDelta,
  rankPreviews,
} from '../../../src/features/drift/previews';

describe('branchLabel (SDD-070 D3)', () => {
  it('reads a pull-request ref as its PR number and keeps the raw value in the title', () => {
    expect(branchLabel('32/merge')).toEqual({ label: 'PR #32', title: 'Rama del reporte: 32/merge' });
    expect(branchLabel('refs/pull/32/merge')).toEqual({ label: 'PR #32', title: 'Rama del reporte: refs/pull/32/merge' });
    expect(branchLabel('refs/pull/32/head')).toEqual({ label: 'PR #32', title: 'Rama del reporte: refs/pull/32/head' });
  });

  it('leaves a plain branch name alone', () => {
    expect(branchLabel('feat/fr-002-importer')).toEqual({
      label: 'feat/fr-002-importer',
      title: 'Rama del reporte: feat/fr-002-importer',
    });
  });

  it('names a missing branch instead of rendering an empty cell', () => {
    expect(branchLabel(null)).toEqual({ label: '(rama desconocida)', title: 'Rama del reporte: (desconocida)' });
  });

  it('does not read a bare number or a slashless ref as a pull request', () => {
    expect(branchLabel('32')).toEqual({ label: '32', title: 'Rama del reporte: 32' });
    expect(branchLabel('32/head')).toEqual({ label: '32/head', title: 'Rama del reporte: 32/head' });
  });
});

describe('issueDelta (SDD-070 D2)', () => {
  it('counts issues gained, lost or unchanged against the official report', () => {
    expect(issueDelta(8, 6)).toBe(2);
    expect(issueDelta(6, 6)).toBe(0);
    expect(issueDelta(2, 6)).toBe(-4);
  });

  it('has no delta without a reference', () => {
    expect(issueDelta(8, null)).toBeNull();
  });
});

describe('formatDelta (SDD-070 D2)', () => {
  it('signs the absolute count and adds no thousands separator', () => {
    expect(formatDelta(2)).toBe('+2');
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(-4)).toBe('-4');
    expect(formatDelta(1540)).toBe('+1540');
  });
});

describe('deltaTone (SDD-070 D2)', () => {
  it('maps the sign to a tone, and a missing reference to its own tone', () => {
    expect(deltaTone(2)).toBe('worse');
    expect(deltaTone(-4)).toBe('better');
    expect(deltaTone(0)).toBe('same');
    expect(deltaTone(null)).toBe('unknown');
  });
});

describe('deltaLine (SDD-070 D2)', () => {
  it('names the official branch and signs the delta', () => {
    expect(deltaLine(2, 'main')).toBe('+2 vs main');
    expect(deltaLine(0, 'main')).toBe('0 vs main');
    expect(deltaLine(-4, 'main')).toBe('-4 vs main');
  });

  it('never invents a 0 when there is no official report to compare against', () => {
    expect(deltaLine(null, 'main')).toBe('— vs main');
  });
});

type Preview = { readonly branch: string; readonly issueCount: number };

describe('rankPreviews (SDD-070 D6)', () => {
  it('puts the worst delta first, tie-breaking by count and then by branch', () => {
    const previews: readonly Preview[] = [
      { branch: 'feat/b', issueCount: 6 },
      { branch: 'feat/a', issueCount: 6 },
      { branch: 'feat/c', issueCount: 2 },
      { branch: '32/merge', issueCount: 8 },
    ];
    expect(rankPreviews(previews, 6).map((preview) => preview.branch)).toEqual([
      '32/merge',
      'feat/a',
      'feat/b',
      'feat/c',
    ]);
  });

  it('keeps the reported order untouched when there is no reference', () => {
    const previews: readonly Preview[] = [
      { branch: 'feat/b', issueCount: 2 },
      { branch: 'feat/a', issueCount: 8 },
    ];
    expect(rankPreviews(previews, null).map((preview) => preview.branch)).toEqual(['feat/b', 'feat/a']);
  });

  it('never mutates the array it is handed', () => {
    const previews: Preview[] = [{ branch: 'feat/a', issueCount: 2 }, { branch: 'feat/b', issueCount: 8 }];
    rankPreviews(previews, 6);
    expect(previews.map((preview) => preview.branch)).toEqual(['feat/a', 'feat/b']);
  });
});
