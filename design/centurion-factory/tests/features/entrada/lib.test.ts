import { describe, expect, it } from 'vitest';
import type { InboxItem } from '../../../src/data';
import { daysSince, formatRelativeDays, formatScore, isOverdue, nextFeatureRequestId, nextFeedbackId, rankCandidates } from '../../../src/features/entrada/lib';

const NOW = new Date('2026-09-15T13:00:00.000Z');

describe('daysSince / formatRelativeDays', () => {
  it('reports 0 days and "hoy" for something received earlier today', () => {
    expect(daysSince('2026-09-15T08:00:00.000Z', NOW)).toBe(0);
    expect(formatRelativeDays('2026-09-15T08:00:00.000Z', NOW)).toBe('hoy');
  });

  it('reports whole days elapsed', () => {
    expect(daysSince('2026-09-12T09:00:00.000Z', NOW)).toBe(3);
    expect(formatRelativeDays('2026-09-12T09:00:00.000Z', NOW)).toBe('hace 3 d');
  });

  it('never goes negative for a future timestamp', () => {
    expect(daysSince('2026-09-20T00:00:00.000Z', NOW)).toBe(0);
  });
});

describe('isOverdue', () => {
  it('is overdue past 2 days', () => {
    expect(isOverdue('2026-09-12T09:00:00.000Z', NOW)).toBe(true);
  });

  it('is not overdue at 2 days or fewer', () => {
    expect(isOverdue('2026-09-14T09:00:00.000Z', NOW)).toBe(false);
    expect(isOverdue('2026-09-13T09:00:00.000Z', NOW)).toBe(false);
  });
});

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'FB-100',
    kind: 'FB',
    title: 'Título',
    body: 'Cuerpo',
    source: 'slack',
    status: 'new',
    links: [],
    receivedAt: '2026-09-12T00:00:00.000Z',
    candidates: [],
    sample: true,
    ...overrides,
  };
}

describe('rankCandidates', () => {
  it('sorts by score descending and flags the best match', () => {
    const ranked = rankCandidates(
      item({
        candidates: [
          { featureId: 'PRD-004', score: 0.61, reason: 'menciona drift' },
          { featureId: 'FR-003', score: 0.92, reason: 'menciona drift por rama' },
        ],
      }),
    );
    expect(ranked.map((c) => c.featureId)).toEqual(['FR-003', 'PRD-004']);
    expect(ranked[0]?.isBestMatch).toBe(true);
    expect(ranked[1]?.isBestMatch).toBe(false);
  });

  it('returns an empty list when there are no candidates', () => {
    expect(rankCandidates(item({ candidates: [] }))).toEqual([]);
  });
});

describe('nextFeedbackId', () => {
  it('increments past the highest existing FB id', () => {
    expect(nextFeedbackId([item({ id: 'FB-001' }), item({ id: 'FB-009' }), item({ id: 'ART-005', kind: 'ART' })])).toBe('FB-010');
  });

  it('starts at FB-001 when there are none yet', () => {
    expect(nextFeedbackId([])).toBe('FB-001');
  });
});

describe('nextFeatureRequestId', () => {
  it('increments past the highest existing FR id, matching the canvas FR-006', () => {
    expect(nextFeatureRequestId(['MRD-001', 'PRD-001', 'FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005'])).toBe('FR-006');
  });
});

describe('formatScore', () => {
  it('uses a comma decimal separator, matching the canvas score bars', () => {
    expect(formatScore(0.92)).toBe('0,92');
    expect(formatScore(0.5)).toBe('0,50');
  });
});
