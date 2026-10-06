import { describe, expect, test } from 'vitest';
import { ageDaysFrom } from '../../src/graph/work-order-age.js';

const NOW = new Date('2026-10-06T03:00:00.000Z');

describe('ageDaysFrom (SDD-075 D1)', () => {
  test('returns null when there is no date', () => {
    expect(ageDaysFrom(null, NOW)).toBeNull();
    expect(ageDaysFrom(undefined, NOW)).toBeNull();
    expect(ageDaysFrom('', NOW)).toBeNull();
  });

  test('returns null for an unparseable date', () => {
    expect(ageDaysFrom('no-es-fecha', NOW)).toBeNull();
  });

  test('returns 0 for the same day and for a future date', () => {
    expect(ageDaysFrom('2026-10-06', NOW)).toBe(0);
    expect(ageDaysFrom('2026-12-31', NOW)).toBe(0);
  });

  test('counts complete 24h periods from a date-only value (midnight UTC)', () => {
    expect(ageDaysFrom('2026-10-01', NOW)).toBe(5);
  });

  test('returns exactly 7 for exactly seven days', () => {
    expect(ageDaysFrom('2026-09-29T03:00:00.000Z', NOW)).toBe(7);
  });
});
