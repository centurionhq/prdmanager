import { describe, expect, test } from 'vitest';
import type { PrdmConfig } from '../../src/config.js';
import { decideLinks, extractFeatureMentions, proposalTitle } from '../../src/feedback/triage.js';
import type { SearchHit } from '../../src/graph/types.js';

const triage: PrdmConfig['triage'] = { autoLinkMinScore: 1.5, autoLinkMargin: 1.2, maxCandidates: 5 };

function hit(id: string, score: number): SearchHit {
  return { id, label: 'Feature', title: id, status: 'approved', score };
}

describe('extractFeatureMentions', () => {
  test('extracts unique MRD/PRD/FR ids in order of first appearance', () => {
    expect(extractFeatureMentions('See PRD-001 and MRD-001, also PRD-001 again, FR-042')).toEqual(['PRD-001', 'MRD-001', 'FR-042']);
  });

  test('returns an empty array when there are no mentions', () => {
    expect(extractFeatureMentions('no ids here')).toEqual([]);
  });

  test('ignores kinds that are not features (WO, SDD, ART, FB)', () => {
    expect(extractFeatureMentions('WO-001 SDD-001 ART-001 FB-001')).toEqual([]);
  });
});

describe('decideLinks', () => {
  test('explicit mentions win over any candidate score', () => {
    expect(decideLinks(['PRD-001'], [hit('FR-002', 10)], triage)).toEqual({ autoLinkTo: ['PRD-001'], reason: 'mention' });
  });

  test('auto-links the top candidate when score clears the threshold and margin', () => {
    expect(decideLinks([], [hit('PRD-001', 3), hit('FR-002', 2)], triage)).toEqual({ autoLinkTo: ['PRD-001'], reason: 'score' });
  });

  test('does not auto-link when top score is below the minimum', () => {
    expect(decideLinks([], [hit('PRD-001', 1.2)], triage)).toEqual({ autoLinkTo: [], reason: 'none' });
  });

  test('does not auto-link when the runner-up is too close (ambiguous)', () => {
    expect(decideLinks([], [hit('PRD-001', 2), hit('FR-002', 1.8)], triage)).toEqual({ autoLinkTo: [], reason: 'none' });
  });

  test('auto-links a lone candidate above threshold with no runner-up', () => {
    expect(decideLinks([], [hit('PRD-001', 1.5)], triage)).toEqual({ autoLinkTo: ['PRD-001'], reason: 'score' });
  });

  test('returns none when there are no mentions and no candidates', () => {
    expect(decideLinks([], [], triage)).toEqual({ autoLinkTo: [], reason: 'none' });
  });
});

describe('proposalTitle', () => {
  test('takes the first sentence of the first non-empty line', () => {
    expect(proposalTitle('Hello world. More context here.\nsecond line')).toBe('Hello world');
  });

  test('falls back to the whole line when there is no sentence terminator', () => {
    expect(proposalTitle('no periods here\nsecond line')).toBe('no periods here');
  });

  test('skips leading blank lines', () => {
    expect(proposalTitle('\n\nActual content.')).toBe('Actual content');
  });

  test('truncates to 80 chars when there is no early sentence terminator', () => {
    const long = 'x'.repeat(120);
    expect(proposalTitle(long)).toHaveLength(80);
  });
});
